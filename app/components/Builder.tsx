'use client';

import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { buildCatalogTarget, type CatalogProductId } from '@/lib/catalog';
import { decompose } from '@/lib/decompose';
import { getPublisherLeaderboard } from '@/lib/indexer';
import { getAppNetworkConfig } from '@/lib/network-config';
import { optimize, optimizeSparse } from '@/lib/optimizer';
import { breakevens, ev, legProb, maxGain } from '@/lib/payoff';
import { PredictClient, loadOracleState } from '@/lib/predict-client';
import type { PythNavAnchor } from '@/lib/pyth';
import { USDC, type OracleState, type SparseTarget, type StructureQuote, type Template } from '@/lib/types';
import { Backtester } from './Backtester';
import { CatalogPicker } from './CatalogPicker';
import { CreatorLeaderboard } from './CreatorLeaderboard';
import { DrawPayoffCanvas, defaultDrawTarget } from './DrawPayoffCanvas';
import { IntentBar } from './IntentBar';
import { MintButton } from './MintButton';
import { NoteAnalyticsPanel } from './NoteAnalyticsPanel';
import { OraclePanel } from './OraclePanel';
import { PayoffChart } from './PayoffChart';
import { PortfolioPanel } from './PortfolioPanel';
import { NoteCollateralPanel } from './NoteCollateralPanel';
import { ReplicationProofPanel } from './ReplicationProofPanel';
import { PositionsDashboard } from './PositionsDashboard';
import { ScenarioSliders, type Scenario } from './ScenarioSliders';
import { ShareNoteButton } from './ShareNoteButton';
import { SolverInspector } from './SolverInspector';
import { StructureSummary } from './StructureSummary';
import { TemplatePicker, defaultTemplate } from './TemplatePicker';
import { TranchePanel } from './TranchePanel';
import { VaultMarket } from './VaultMarket';
import { WalletControls } from './WalletControls';

const appConfig = getAppNetworkConfig();
const STUDIO_PACKAGE = appConfig.predictStudioPackage;

function withScenario(oracle: OracleState, scenario: Scenario): OracleState {
  return {
    ...oracle,
    spot: oracle.spot * (1 + scenario.spotShiftPct / 100),
    forward: oracle.forward * (1 + scenario.spotShiftPct / 100),
    svi: {
      ...oracle.svi,
      sigma: Math.max(0.000001, oracle.svi.sigma * (1 + scenario.volShiftPct / 100)),
    },
  };
}

async function loadPythBtcAnchor(): Promise<PythNavAnchor> {
  const response = await fetch('/api/pyth/btc', { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? 'Pyth BTC unavailable');
  }
  return response.json() as Promise<PythNavAnchor>;
}

export function Builder() {
  const sui = useSuiClient();
  const account = useCurrentAccount();
  const [scenario, setScenario] = useState<Scenario>({ spotShiftPct: 0, volShiftPct: 0 });
  const oracleQuery = useQuery({
    queryKey: ['oracle-state', appConfig.oracleId, appConfig.managerId, appConfig.dusdcType],
    queryFn: () =>
      loadOracleState(sui, {
        oracleId: appConfig.oracleId,
        managerId: appConfig.managerId,
        dusdcType: appConfig.dusdcType,
      }),
  });
  const publisherQuery = useQuery({
    queryKey: ['publisher-leaderboard', STUDIO_PACKAGE],
    queryFn: () => (STUDIO_PACKAGE === '0x0' ? [] : getPublisherLeaderboard(sui, STUDIO_PACKAGE)),
  });
  const pythQuery = useQuery({
    queryKey: ['pyth-btc-anchor'],
    queryFn: loadPythBtcAnchor,
    refetchInterval: 30_000,
  });
  const oracle = oracleQuery.data ? withScenario(oracleQuery.data, scenario) : undefined;
  const [template, setTemplate] = useState<Template | null>(null);
  const [quoteMode, setQuoteMode] = useState<'template' | 'catalog' | 'draw' | 'intent'>('template');
  const [catalogId, setCatalogId] = useState<CatalogProductId>('fixed_coupon_range');
  const [drawTarget, setDrawTarget] = useState<SparseTarget | null>(null);
  const [intentTarget, setIntentTarget] = useState<SparseTarget | null>(null);
  const [intentEcho, setIntentEcho] = useState<string | undefined>();
  const [quote, setQuote] = useState<StructureQuote | undefined>();
  const [quoteSource, setQuoteSource] = useState('local SVI estimate');
  const [digest, setDigest] = useState<string | undefined>();
  const client = useMemo(
    () => new PredictClient(sui, STUDIO_PACKAGE, oracle?.dbpPackage ?? appConfig.deepbookPredictPackage),
    [sui, oracle?.dbpPackage],
  );

  useEffect(() => {
    if (oracle && !template) setTemplate(defaultTemplate(oracle));
    if (oracle && !drawTarget) setDrawTarget(defaultDrawTarget(oracle));
  }, [drawTarget, oracle, template]);

  useEffect(() => {
    if (!oracle || !template) return;
    let active = true;

    if (quoteMode === 'catalog' || quoteMode === 'draw' || quoteMode === 'intent') {
      const target = quoteMode === 'catalog' ? buildCatalogTarget(catalogId, oracle) : quoteMode === 'draw' ? drawTarget : intentTarget;
      if (!target) return;
      const res = optimizeSparse(target, oracle.svi, oracle.forward);
      const totalCost = Math.round(res.best.premiumEst * USDC);
      setQuoteSource(quoteMode === 'intent' ? 'AI intent sparse SVI estimate' : 'NNOMP sparse SVI estimate');
      setQuote({
        legs: res.best.legs,
        totalCost,
        maxLoss: totalCost,
        maxGain: maxGain(res.best.legs, totalCost),
        breakevens: breakevens(res.best.legs, totalCost),
        ev: ev(res.best.legs, oracle.svi, oracle.forward, totalCost),
        savingsVsNaive: 0,
      });
      return () => {
        active = false;
      };
    }

    const base = decompose(template, oracle);

    const quoteLeg = async (leg: (typeof base.legs)[number]) => {
      if (account) {
        try {
          const ask = await client.quoteLeg(oracle, leg, account.address);
          setQuoteSource('devInspect live ask');
          return ask;
        } catch {
          setQuoteSource('local SVI estimate');
        }
      }
      return legProb(oracle.svi, oracle.forward, leg) * leg.quantity;
    };

    optimize(base, oracle, quoteLeg)
      .then((res) => {
        if (!active) return;
        const totalCost = res.best.totalCost;
        setQuote({
          legs: res.best.legs,
          totalCost,
          maxLoss: totalCost,
          maxGain: maxGain(res.best.legs, totalCost),
          breakevens: breakevens(res.best.legs, totalCost),
          ev: ev(res.best.legs, oracle.svi, oracle.forward, totalCost),
          savingsVsNaive: res.savingsVsNaive,
        });
      })
      .catch(() => {
        if (active) setQuote(undefined);
      });

    return () => {
      active = false;
    };
  }, [account, catalogId, client, drawTarget, intentTarget, oracle, quoteMode, template]);

  const sparseTarget = useMemo(() => {
    if (!oracle) return undefined;
    if (quoteMode === 'catalog') return buildCatalogTarget(catalogId, oracle);
    if (quoteMode === 'draw') return drawTarget ?? undefined;
    if (quoteMode === 'intent') return intentTarget ?? undefined;
    return undefined;
  }, [catalogId, drawTarget, intentTarget, oracle, quoteMode]);

  return (
    <main className="app-shell">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="metric-label">DeepBook Predict</div>
          <h1 className="text-2xl font-semibold tracking-normal">Predict Studio</h1>
        </div>
        <WalletControls />
      </header>

      <OraclePanel
        oracle={oracleQuery.data}
        loading={oracleQuery.isLoading}
        error={oracleQuery.error instanceof Error ? oracleQuery.error.message : undefined}
        pythAnchor={pythQuery.data}
        pythLoading={pythQuery.isLoading}
        pythError={pythQuery.error instanceof Error ? pythQuery.error.message : undefined}
        onRefresh={() => {
          void oracleQuery.refetch();
          void pythQuery.refetch();
        }}
      />

      {oracle && template ? (
        <>
          <IntentBar
            oracle={oracle}
            quote={quoteMode === 'intent' ? quote : undefined}
            activeEcho={quoteMode === 'intent' ? intentEcho : undefined}
            onIntent={(intent) => {
              setIntentTarget(intent.target);
              setIntentEcho(intent.echo);
              setQuoteMode('intent');
            }}
          />
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr_360px]">
          <div className="grid content-start gap-4">
            <TemplatePicker
              oracle={oracle}
              template={template}
              onChange={(next) => {
                setQuoteMode('template');
                setTemplate(next);
              }}
            />
            <CatalogPicker
              selected={catalogId}
              onChange={(id) => {
                setCatalogId(id);
                setQuoteMode('catalog');
              }}
            />
            {drawTarget ? (
              <DrawPayoffCanvas
                target={drawTarget}
                onChange={(target) => {
                  setDrawTarget(target);
                  setQuoteMode('draw');
                }}
              />
            ) : null}
            <ScenarioSliders scenario={scenario} onChange={setScenario} />
            <MintButton
              client={client}
              oracle={oracle}
              legs={quote?.legs ?? []}
              shape={quoteMode === 'catalog' ? catalogId : quoteMode === 'draw' ? 'drawn_payoff' : quoteMode === 'intent' ? 'ai_intent' : template.kind}
              maxLossBudget={quote?.totalCost ?? 0}
              disabled={!account || STUDIO_PACKAGE === '0x0'}
              onMinted={setDigest}
            />
            {digest ? <div className="surface break-all px-3 py-2 text-sm good-text">Digest {digest}</div> : null}
          </div>

          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="metric-label">Payoff</div>
                <h2 className="text-base font-semibold">Settlement P&L</h2>
              </div>
              <div className="metric-value text-sm">
                Premium ${((quote?.totalCost ?? 0) / USDC).toFixed(2)}
              </div>
            </div>
            <PayoffChart
              legs={quote?.legs ?? []}
              premium={quote?.totalCost ?? 0}
              lo={oracle.spot * 0.9}
              hi={oracle.spot * 1.1}
              spot={oracle.spot}
              breakevens={quote?.breakevens ?? []}
            />
          </section>

          <div className="grid content-start gap-4">
            <StructureSummary quote={quote} quoteSource={quoteSource} />
            {quote ? <NoteAnalyticsPanel oracle={oracle} legs={quote.legs} premium={quote.totalCost} /> : null}
            {quote ? <ReplicationProofPanel legs={quote.legs} premium={quote.totalCost} target={sparseTarget} liveDigest={digest} /> : null}
            {quote ? (
              <NoteCollateralPanel
                pkg={STUDIO_PACKAGE}
                oracle={oracle}
                legs={quote.legs}
                shape={quoteMode === 'catalog' ? catalogId : quoteMode === 'draw' ? 'drawn_payoff' : quoteMode === 'intent' ? 'ai_intent' : template.kind}
                premium={quote.totalCost}
                maxPayout={quote.maxGain}
                marketId={appConfig.collateralMarketId}
              />
            ) : null}
            <ShareNoteButton echo={intentEcho ?? quoteMode} target={sparseTarget} quote={quote} />
            {sparseTarget ? <SolverInspector oracle={oracle} target={sparseTarget} /> : null}
            <Backtester legs={quote?.legs ?? []} premium={quote?.totalCost ?? 0} oracle={oracle} />
            <TranchePanel />
            <CreatorLeaderboard ranks={publisherQuery.data ?? []} />
            {quote ? <PortfolioPanel oracle={oracle} positions={[{ legs: quote.legs, premium: quote.totalCost }]} /> : null}
          </div>
          </div>
        </>
      ) : null}

      <div className="mt-4">
        <VaultMarket oracle={oracle} />
      </div>

      <div className="mt-4">
        <PositionsDashboard client={client} oracle={oracle} />
      </div>
    </main>
  );
}
