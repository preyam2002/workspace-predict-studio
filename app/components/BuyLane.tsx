'use client';

import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getAppNetworkConfig } from '@/lib/network-config';
import { breakevens, ev, maxGain } from '@/lib/payoff';
import { PredictClient, loadOracleState } from '@/lib/predict-client';
import { USDC, type SparseTarget, type StructureQuote } from '@/lib/types';
import { optimizeSparse } from '@/lib/optimizer';
import { IntentBar } from './IntentBar';
import { MintButton } from './MintButton';
import { NoteAnalyticsPanel } from './NoteAnalyticsPanel';
import { OraclePanel } from './OraclePanel';
import { PayoffChart } from './PayoffChart';
import { StructureSummary } from './StructureSummary';

const appConfig = getAppNetworkConfig();

export function BuyLane() {
  const sui = useSuiClient();
  const account = useCurrentAccount();
  const [target, setTarget] = useState<SparseTarget | undefined>();
  const [echo, setEcho] = useState<string | undefined>();
  const [digest, setDigest] = useState<string | undefined>();
  const oracleQuery = useQuery({
    queryKey: ['buy-lane-oracle-state', appConfig.oracleId, appConfig.managerId, appConfig.dusdcType],
    queryFn: () =>
      loadOracleState(sui, {
        oracleId: appConfig.oracleId,
        managerId: appConfig.managerId,
        dusdcType: appConfig.dusdcType,
      }),
  });
  const oracle = oracleQuery.data;
  const client = useMemo(
    () => new PredictClient(sui, appConfig.predictStudioPackage, oracle?.dbpPackage ?? appConfig.deepbookPredictPackage),
    [sui, oracle?.dbpPackage],
  );
  const quote = useMemo<StructureQuote | undefined>(() => {
    if (!oracle || !target) return undefined;
    const res = optimizeSparse(target, oracle.svi, oracle.forward);
    const totalCost = Math.round(res.best.premiumEst * USDC);
    return {
      legs: res.best.legs,
      totalCost,
      maxLoss: totalCost,
      maxGain: maxGain(res.best.legs, totalCost),
      breakevens: breakevens(res.best.legs, totalCost),
      ev: ev(res.best.legs, oracle.svi, oracle.forward, totalCost),
      savingsVsNaive: 0,
    };
  }, [oracle, target]);

  return (
    <main className="buy-shell">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Gasless buy lane</div>
          <h1 className="text-2xl font-semibold tracking-normal">Predict Studio</h1>
        </div>
        <BadgeDollarSign size={22} className="good-text" />
      </header>
      <OraclePanel
        oracle={oracle}
        loading={oracleQuery.isLoading}
        error={oracleQuery.error instanceof Error ? oracleQuery.error.message : undefined}
        onRefresh={() => void oracleQuery.refetch()}
      />
      {oracle ? (
        <div className="grid gap-4">
          <IntentBar
            oracle={oracle}
            quote={quote}
            activeEcho={echo}
            onIntent={(intent) => {
              setTarget(intent.target);
              setEcho(intent.echo);
            }}
          />
          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="metric-label">Payoff</div>
                <h2 className="text-base font-semibold">At expiry</h2>
              </div>
              <div className="metric-value text-sm">Premium ${((quote?.totalCost ?? 0) / USDC).toFixed(2)}</div>
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
          {quote ? <NoteAnalyticsPanel legs={quote.legs} premium={quote.totalCost} oracle={oracle} /> : null}
          <StructureSummary quote={quote} quoteSource="AI intent sparse SVI estimate" />
          <MintButton
            client={client}
            oracle={oracle}
            legs={quote?.legs ?? []}
            shape="ai_intent"
            maxLossBudget={quote?.totalCost ?? 0}
            disabled={!account || appConfig.predictStudioPackage === '0x0'}
            defaultGasless
            onMinted={setDigest}
          />
          {digest ? <div className="surface break-all px-3 py-2 text-sm good-text">Digest {digest}</div> : null}
        </div>
      ) : null}
    </main>
  );
}
