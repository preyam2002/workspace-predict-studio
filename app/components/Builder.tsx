'use client';

import { ConnectButton, useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildCatalogTarget, type CatalogProductId } from '@/lib/catalog';
import { decompose } from '@/lib/decompose';
import { optimize, optimizeSparse } from '@/lib/optimizer';
import { breakevens, ev, legProb, maxGain } from '@/lib/payoff';
import { PredictClient, loadOracleState } from '@/lib/predict-client';
import { USDC, type OracleState, type StructureQuote, type Template } from '@/lib/types';
import { Backtester } from './Backtester';
import { CatalogPicker } from './CatalogPicker';
import { MintButton } from './MintButton';
import { OraclePanel } from './OraclePanel';
import { PayoffChart } from './PayoffChart';
import { PositionsDashboard } from './PositionsDashboard';
import { ScenarioSliders, type Scenario } from './ScenarioSliders';
import { SolverInspector } from './SolverInspector';
import { StructureSummary } from './StructureSummary';
import { TemplatePicker, defaultTemplate } from './TemplatePicker';
import { TranchePanel } from './TranchePanel';
import { VaultMarket } from './VaultMarket';

const STUDIO_PACKAGE = process.env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE ?? '0x0';

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

export function Builder() {
  const sui = useSuiClient();
  const account = useCurrentAccount();
  const [scenario, setScenario] = useState<Scenario>({ spotShiftPct: 0, volShiftPct: 0 });
  const oracleQuery = useQuery({
    queryKey: ['oracle-state'],
    queryFn: () => loadOracleState(sui),
  });
  const oracle = oracleQuery.data ? withScenario(oracleQuery.data, scenario) : undefined;
  const [template, setTemplate] = useState<Template | null>(null);
  const [quoteMode, setQuoteMode] = useState<'template' | 'catalog'>('template');
  const [catalogId, setCatalogId] = useState<CatalogProductId>('fixed_coupon_range');
  const [quote, setQuote] = useState<StructureQuote | undefined>();
  const [quoteSource, setQuoteSource] = useState('local SVI estimate');
  const [digest, setDigest] = useState<string | undefined>();
  const client = useMemo(
    () => new PredictClient(sui, STUDIO_PACKAGE, oracle?.dbpPackage ?? process.env.NEXT_PUBLIC_DEEPBOOK_PREDICT_PACKAGE ?? '0x0'),
    [sui, oracle?.dbpPackage],
  );

  useEffect(() => {
    if (oracle && !template) setTemplate(defaultTemplate(oracle));
  }, [oracle, template]);

  useEffect(() => {
    if (!oracle || !template) return;
    let active = true;

    if (quoteMode === 'catalog') {
      const target = buildCatalogTarget(catalogId, oracle);
      const res = optimizeSparse(target, oracle.svi, oracle.forward);
      const totalCost = Math.round(res.best.premiumEst * USDC);
      setQuoteSource('NNOMP sparse SVI estimate');
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
  }, [account, catalogId, client, oracle, quoteMode, template]);

  const catalogTarget = useMemo(() => (oracle ? buildCatalogTarget(catalogId, oracle) : undefined), [catalogId, oracle]);

  return (
    <main className="app-shell">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="metric-label">DeepBook Predict</div>
          <h1 className="text-2xl font-semibold tracking-normal">Predict Studio</h1>
        </div>
        <div className="flex items-center gap-2">
          <WalletCards size={18} className="blue-text" />
          <ConnectButton />
        </div>
      </header>

      <OraclePanel
        oracle={oracleQuery.data}
        loading={oracleQuery.isLoading}
        error={oracleQuery.error instanceof Error ? oracleQuery.error.message : undefined}
        onRefresh={() => oracleQuery.refetch()}
      />

      {oracle && template ? (
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
            <ScenarioSliders scenario={scenario} onChange={setScenario} />
            <MintButton
              client={client}
              oracle={oracle}
              legs={quote?.legs ?? []}
              shape={quoteMode === 'catalog' ? catalogId : template.kind}
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
            {catalogTarget ? <SolverInspector oracle={oracle} target={catalogTarget} /> : null}
            <Backtester legs={quote?.legs ?? []} premium={quote?.totalCost ?? 0} />
            <TranchePanel />
          </div>
        </div>
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
