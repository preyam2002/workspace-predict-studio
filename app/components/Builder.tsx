'use client';

import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildCatalogTarget, type CatalogProductId } from '@/lib/catalog';
import { decompose } from '@/lib/decompose';
import { activeOracleChoices, getOracles } from '@/lib/indexer';
import { getAppNetworkConfig, isConfiguredId } from '@/lib/network-config';
import { optimize, optimizeSparse, scaleLegsToTargetGross } from '@/lib/optimizer';
import { breakevens, ev, legProb, maxGain } from '@/lib/payoff';
import { getManagerOwner, isLiveOracleState, loadOracleState, PredictClient } from '@/lib/predict-client';
import type { PythNavAnchor } from '@/lib/pyth';
import { USDC, type Leg, type OracleState, type SparseTarget, type StructureQuote, type Template } from '@/lib/types';
import { CatalogPicker } from './CatalogPicker';
import { ExplorerLink } from './ExplorerLink';
import { IntentBar } from './IntentBar';
import { MintButton } from './MintButton';
import { NoteAnalyticsPanel } from './NoteAnalyticsPanel';
import { OraclePanel } from './OraclePanel';
import { PayoffChart } from './PayoffChart';
import { NoteCollateralPanel } from './NoteCollateralPanel';
import { ReplicationProofPanel } from './ReplicationProofPanel';
import { PositionsDashboard } from './PositionsDashboard';
import { SolverInspector } from './SolverInspector';
import { StructureSummary } from './StructureSummary';
import { TemplatePicker, defaultTemplate } from './TemplatePicker';
import { TradingAccountPanel, useWalletManagerId } from './TradingAccountPanel';
import { WalletControls } from './WalletControls';

const appConfig = getAppNetworkConfig();
const STUDIO_PACKAGE = appConfig.predictStudioPackage;

async function loadPythBtcAnchor(): Promise<PythNavAnchor> {
  const response = await fetch('/api/pyth/btc', { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? 'Pyth BTC unavailable');
  }
  return response.json() as Promise<PythNavAnchor>;
}

function scaleSparseTarget(target: SparseTarget, scaleUsd: number): SparseTarget {
  const maxTarget = Math.max(0, ...target.g);
  const scale = maxTarget > 0 ? Math.max(0, scaleUsd) / maxTarget : 0;
  return { ...target, g: target.g.map((value) => value * scale) };
}

export function Builder() {
  const sui = useSuiClient();
  const account = useCurrentAccount();
  const [walletManagerId, setWalletManagerId] = useWalletManagerId(account?.address);
  const configManagerOwnerQuery = useQuery({
    queryKey: ['config-manager-owner', appConfig.managerId],
    queryFn: () => getManagerOwner(sui, appConfig.managerId as string),
    enabled: Boolean(appConfig.managerId),
  });
  const ownsConfigManager = Boolean(
    account?.address && configManagerOwnerQuery.data && account.address.toLowerCase() === configManagerOwnerQuery.data.toLowerCase(),
  );
  const effectiveManagerId = ownsConfigManager ? appConfig.managerId : walletManagerId ?? appConfig.managerId;
  const [selectedOracleId, setSelectedOracleId] = useState(appConfig.oracleId);
  const oracleQuery = useQuery({
    queryKey: ['oracle-state', selectedOracleId, effectiveManagerId, appConfig.dusdcType],
    queryFn: () =>
      loadOracleState(sui, {
        oracleId: selectedOracleId,
        managerId: effectiveManagerId,
        dusdcType: appConfig.dusdcType,
      }),
  });
  const oracleOptionsQuery = useQuery({
    queryKey: ['oracle-options'],
    queryFn: getOracles,
    refetchInterval: 30_000,
  });
  const pythQuery = useQuery({
    queryKey: ['pyth-btc-anchor'],
    queryFn: loadPythBtcAnchor,
    refetchInterval: 30_000,
  });
  const oracle = useMemo(() => oracleQuery.data ?? undefined, [oracleQuery.data]);
  const oracleOptions = useMemo(
    () => activeOracleChoices(oracleOptionsQuery.data ?? [], oracle?.underlyingAsset ?? 'BTC'),
    [oracleOptionsQuery.data, oracle?.underlyingAsset],
  );
  const managerOwnerQuery = useQuery({
    queryKey: ['manager-owner', oracle?.managerId],
    queryFn: () => {
      if (!oracle?.managerId) throw new Error('Missing manager id');
      return getManagerOwner(sui, oracle.managerId);
    },
    enabled: Boolean(oracle?.managerId),
  });
  const [template, setTemplate] = useState<Template | null>(null);
  const [quoteMode, setQuoteMode] = useState<'template' | 'catalog' | 'intent'>('template');
  const [catalogId, setCatalogId] = useState<CatalogProductId>('fixed_coupon_range');
  const [catalogPayoutUsd, setCatalogPayoutUsd] = useState(100);
  const [intentTarget, setIntentTarget] = useState<SparseTarget | null>(null);
  const [intentEcho, setIntentEcho] = useState<string | undefined>();
  const [quote, setQuote] = useState<StructureQuote | undefined>();
  const [quoteSource, setQuoteSource] = useState('local SVI estimate');
  const [digest, setDigest] = useState<string | undefined>();
  const [mintedPositionId, setMintedPositionId] = useState<string | undefined>();
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const client = useMemo(
    () => new PredictClient(sui, STUDIO_PACKAGE, oracle?.dbpPackage ?? appConfig.deepbookPredictPackage),
    [sui, oracle?.dbpPackage],
  );

  useEffect(() => {
    if (oracle) setTemplate(defaultTemplate(oracle));
  }, [oracle?.oracleId]);

  useEffect(() => {
    if (!oracle || !template) return;
    let active = true;
    if (!isLiveOracleState(oracle)) {
      setQuoteSource('Oracle expired');
      setQuote(undefined);
      return;
    }

    const quoteLeg = async (leg: Leg) => {
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

    if (quoteMode === 'catalog' || quoteMode === 'intent') {
      const target = quoteMode === 'catalog' ? scaleSparseTarget(buildCatalogTarget(catalogId, oracle), catalogPayoutUsd) : intentTarget;
      if (!target) return;
      const res = optimizeSparse(target, oracle.svi, oracle.forward);
      const legs = scaleLegsToTargetGross(res.best.legs, target);
      if (!account) setQuoteSource(quoteMode === 'intent' ? 'AI intent sparse SVI estimate' : 'NNOMP sparse SVI estimate');
      Promise.all(legs.map(quoteLeg))
        .then((costs) => {
          if (!active) return;
          const totalCost = Math.round(costs.reduce((sum, cost) => sum + cost, 0));
          setQuote({
            legs,
            totalCost,
            maxLoss: totalCost,
            maxGain: maxGain(legs, totalCost),
            breakevens: breakevens(legs, totalCost),
            ev: ev(legs, oracle.svi, oracle.forward, totalCost),
            savingsVsNaive: Math.round(res.savingsVsNaive * USDC),
          });
        })
        .catch(() => {
          if (active) setQuote(undefined);
        });
      return () => {
        active = false;
      };
    }

    const base = decompose(template, oracle);

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
  }, [account, catalogId, catalogPayoutUsd, client, intentTarget, oracle, quoteMode, template]);

  const sparseTarget = useMemo(() => {
    if (!oracle) return undefined;
    if (quoteMode === 'catalog') return scaleSparseTarget(buildCatalogTarget(catalogId, oracle), catalogPayoutUsd);
    if (quoteMode === 'intent') return intentTarget ?? undefined;
    return undefined;
  }, [catalogId, catalogPayoutUsd, intentTarget, oracle, quoteMode]);
  const activeBuilderLabel =
    quoteMode === 'catalog'
      ? 'Strategy preset'
      : quoteMode === 'intent'
        ? 'Market view'
        : 'Strategy Shape';
  const activeBuilderDetail =
    quoteMode === 'catalog'
      ? 'Catalog preset and Target gross payout $ are active.'
      : quoteMode === 'intent'
        ? 'The market view target is active.'
        : 'Strategy Shape fields are pricing this structure.';
  const activeShape = quoteMode === 'catalog' ? catalogId : quoteMode === 'intent' ? 'ai_intent' : (template?.kind ?? 'template');
  const managerMatchesAccount = Boolean(
    account?.address && managerOwnerQuery.data && account.address.toLowerCase() === managerOwnerQuery.data.toLowerCase(),
  );
  const collateralConfigured = Boolean(
    oracle &&
      managerMatchesAccount &&
      isConfiguredId(appConfig.collateralPackageId) &&
      isConfiguredId(appConfig.collateralMarketId) &&
      isConfiguredId(oracle.managerId) &&
      isConfiguredId(oracle.predictId) &&
      oracle.dusdcType,
  );
  const handleMinted = (nextDigest: string, positionId?: string) => {
    setDigest(nextDigest);
    if (positionId) setMintedPositionId(positionId);
    setPositionsRefreshKey((key) => key + 1);
  };

  const chartSpot = oracle?.spot ?? 0;
  const strikeMarks = (quote?.legs ?? [])
    .flatMap((leg) => (leg.isRange ? [leg.lowerStrike, leg.higherStrike] : [leg.lowerStrike]))
    .filter((strike) => strike > 0);
  const chartLo = Math.min(chartSpot * 0.88, ...strikeMarks.map((strike) => strike - chartSpot * 0.05));
  const chartHi = Math.max(chartSpot * 1.12, ...strikeMarks.map((strike) => strike + chartSpot * 0.05));

  return (
    <main className="app-shell">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-2">
          <span className="eyebrow w-fit">
            <span className="live-dot" aria-hidden />
            DeepBook Predict
          </span>
          <h1 className="brand-mark text-3xl tracking-tight">
            Predict <span className="glow-volt">Studio</span>
          </h1>
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
        oracleOptions={oracleOptions}
        selectedOracleId={oracle?.oracleId ?? selectedOracleId}
        onOracleChange={(oracleId) => {
          setSelectedOracleId(oracleId);
          setQuote(undefined);
          setDigest(undefined);
          setMintedPositionId(undefined);
        }}
        onRefresh={() => {
          void oracleQuery.refetch();
          void oracleOptionsQuery.refetch();
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
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
            <div className="grid content-start gap-4">
              <BuildModePanel
                active={quoteMode}
                label={activeBuilderLabel}
                detail={activeBuilderDetail}
                onSelect={(mode) => setQuoteMode(mode)}
              />
              <TradingAccountPanel
                accountAddress={account?.address}
                client={client}
                oracle={oracle}
                managerOwner={managerOwnerQuery.data}
                depositAmount={quote?.totalCost}
                onManagerReady={setWalletManagerId}
              />
              {quoteMode === 'template' ? (
                <TemplatePicker
                  oracle={oracle}
                  template={template}
                  onChange={(next) => {
                    setQuoteMode('template');
                    setTemplate(next);
                  }}
                />
              ) : null}
              {quoteMode === 'catalog' ? (
                <div className="grid gap-3">
                  <CatalogPicker
                    selected={catalogId}
                    onChange={(id) => {
                      setCatalogId(id);
                      setQuoteMode('catalog');
                    }}
                  />
                  <label className="surface grid gap-1 px-3 py-2 text-xs">
                    <span className="metric-label">Target gross payout $</span>
                    <input
                      className="bg-transparent outline-none metric-value"
                      inputMode="numeric"
                      value={catalogPayoutUsd}
                      onChange={(event) => {
                        setCatalogPayoutUsd(Math.max(0, Number(event.target.value) || 0));
                        setQuoteMode('catalog');
                      }}
                    />
                  </label>
                </div>
              ) : null}
              {quoteMode === 'intent' ? (
                <div className="surface px-3 py-2 text-sm muted-text">Market view controls are above. Edit the sentence and press Build to replace this quote.</div>
              ) : null}
              <MintButton
                client={client}
                oracle={oracle}
                legs={quote?.legs ?? []}
                shape={activeShape}
                maxLossBudget={quote?.totalCost ?? 0}
                netMaxGain={quote?.maxGain}
                accountAddress={account?.address}
                managerOwner={managerOwnerQuery.data}
                disabled={STUDIO_PACKAGE === '0x0'}
                onMinted={handleMinted}
              />
              {digest ? (
                <div className="surface break-all px-3 py-2 text-sm">
                  <div className="metric-label">Last mint</div>
                  <div className="mt-1">
                    <span className="metric-label mr-2">Digest</span>
                    <span className="metric-value good-text">
                      <ExplorerLink value={digest} />
                    </span>
                  </div>
                  {mintedPositionId ? (
                    <div className="mt-1">
                      <span className="metric-label mr-2">Receipt</span>
                      <span className="metric-value">
                        <ExplorerLink value={mintedPositionId} kind="object" />
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 text-xs muted-text">Waiting for the owned receipt to index.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid content-start gap-4">
              <section className="panel p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="metric-label">Payoff</div>
                    <h2 className="text-lg font-semibold">Settlement P&L</h2>
                  </div>
                  <div className="surface px-3 py-1.5 text-sm">
                    <span className="metric-label mr-2">Premium</span>
                    <span className="metric-value glow-volt">${((quote?.totalCost ?? 0) / USDC).toFixed(2)}</span>
                  </div>
                </div>
                <PayoffChart
                  legs={quote?.legs ?? []}
                  premium={quote?.totalCost ?? 0}
                  lo={chartLo}
                  hi={chartHi}
                  spot={oracle.spot}
                  breakevens={quote?.breakevens ?? []}
                />
              </section>

              <StructureSummary quote={quote} quoteSource={quoteSource} />

              <AdvancedSection title="Risk and proof" label="Analytics">
                <div className="grid gap-4 xl:grid-cols-2">
                  {quote ? <NoteAnalyticsPanel oracle={oracle} legs={quote.legs} premium={quote.totalCost} /> : null}
                  {quote ? <ReplicationProofPanel legs={quote.legs} premium={quote.totalCost} target={sparseTarget} liveDigest={digest} /> : null}
                  {sparseTarget ? <SolverInspector oracle={oracle} target={sparseTarget} /> : null}
                </div>
              </AdvancedSection>

              {quote && collateralConfigured ? (
                <AdvancedSection title="Borrow" label="Live actions">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <NoteCollateralPanel
                      pkg={appConfig.collateralPackageId}
                      oracle={oracle}
                      legs={quote.legs}
                      shape={activeShape}
                      premium={quote.totalCost}
                      maxPayout={maxGain(quote.legs, 0)}
                      marketId={appConfig.collateralMarketId}
                    />
                  </div>
                </AdvancedSection>
              ) : null}

              <AdvancedSection title="Owned positions" label="Portfolio" defaultOpen>
                <PositionsDashboard
                  client={client}
                  oracle={oracle}
                  refreshKey={positionsRefreshKey}
                  lastMintDigest={digest}
                  lastMintPositionId={mintedPositionId}
                />
              </AdvancedSection>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

function AdvancedSection({ label, title, children, defaultOpen = false }: { label: string; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <details className="border-t border-[var(--line)] py-3" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="metric-label block">{label}</span>
          <span className="text-base font-semibold">{title}</span>
        </span>
        <span className="metric-value text-sm">{open ? 'Close' : 'Open'}</span>
      </summary>
      <div className="mt-4 grid gap-4">{children}</div>
    </details>
  );
}

function BuildModePanel({
  active,
  label,
  detail,
  onSelect,
}: {
  active: 'template' | 'catalog' | 'intent';
  label: string;
  detail: string;
  onSelect: (mode: 'template' | 'catalog') => void;
}) {
  const modes: Array<{ id: 'template' | 'catalog'; label: string }> = [
    { id: 'template', label: 'Strategy Shape' },
    { id: 'catalog', label: 'Strategy Preset' },
  ];

  return (
    <section className="panel p-4">
      <div className="metric-label">Active builder</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={`icon-button justify-center ${active === mode.id ? 'primary-button' : ''}`}
            type="button"
            onClick={() => onSelect(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="mt-3 surface px-3 py-2 text-sm">
        <div className="metric-value">{label}</div>
        <div className="mt-1 text-xs muted-text">{detail}</div>
      </div>
    </section>
  );
}
