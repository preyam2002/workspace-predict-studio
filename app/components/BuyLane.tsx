'use client';

import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createIntentFallback } from '@/lib/ai-intent';
import { HACKATHON_SPINE, OPTIONS_GAP_WEDGE } from '@/lib/hackathon-copy';
import { activeOracleChoices, getOracles } from '@/lib/indexer';
import { defaultIntentPrompt } from '@/lib/intent-state';
import { getAppNetworkConfig } from '@/lib/network-config';
import { breakevens, ev, legProb, maxGain } from '@/lib/payoff';
import { getManagerOwner, isLiveOracleState, PredictClient, loadOracleState } from '@/lib/predict-client';
import { decodeShareableNote } from '@/lib/shareable-note';
import { USDC, type Leg, type SparseTarget, type StructureQuote } from '@/lib/types';
import { optimizeSparse, scaleLegsToTargetGross } from '@/lib/optimizer';
import { ExplorerLink } from './ExplorerLink';
import { IntentBar } from './IntentBar';
import { LiveProofStrip } from './LiveProofStrip';
import { MintButton } from './MintButton';
import { NoteAnalyticsPanel } from './NoteAnalyticsPanel';
import { OraclePanel } from './OraclePanel';
import { PayoffChart } from './PayoffChart';
import { ReplicationProofPanel } from './ReplicationProofPanel';
import { ShareNoteButton } from './ShareNoteButton';
import { StructureSummary } from './StructureSummary';
import { TradingAccountPanel, useWalletManagerId } from './TradingAccountPanel';
import { WalletControls } from './WalletControls';

const appConfig = getAppNetworkConfig();

function decodeInitialNote(value?: string) {
  if (!value) return undefined;
  try {
    return decodeShareableNote(value);
  } catch {
    return undefined;
  }
}

export function BuyLane({ initialNoteParam, variant = 'buy' }: { initialNoteParam?: string; variant?: 'landing' | 'buy' }) {
  const initialNote = decodeInitialNote(initialNoteParam);
  const sui = useSuiClient();
  const account = useCurrentAccount();
  const [target, setTarget] = useState<SparseTarget | undefined>(initialNote?.target);
  const [echo, setEcho] = useState<string | undefined>(initialNote?.echo);
  const [digest, setDigest] = useState<string | undefined>();
  const [quote, setQuote] = useState<StructureQuote | undefined>();
  const [quoteSource, setQuoteSource] = useState('AI intent sparse SVI estimate');
  const [walletManagerId, setWalletManagerId] = useWalletManagerId(account?.address);
  const configManagerOwnerQuery = useQuery({
    queryKey: ['config-manager-owner', appConfig.managerId],
    queryFn: () => getManagerOwner(sui, appConfig.managerId as string),
    enabled: Boolean(appConfig.managerId),
  });
  // Prefer the pre-funded shared manager whenever the connected wallet owns it,
  // so the funded trading account is used instead of an empty wallet-created one.
  const ownsConfigManager = Boolean(
    account?.address && configManagerOwnerQuery.data && account.address.toLowerCase() === configManagerOwnerQuery.data.toLowerCase(),
  );
  const effectiveManagerId = ownsConfigManager ? appConfig.managerId : walletManagerId ?? appConfig.managerId;
  const [selectedOracleId, setSelectedOracleId] = useState(appConfig.oracleId);
  const oracleQuery = useQuery({
    queryKey: ['buy-lane-oracle-state', selectedOracleId, effectiveManagerId, appConfig.dusdcType],
    queryFn: () =>
      loadOracleState(sui, {
        oracleId: selectedOracleId,
        managerId: effectiveManagerId,
        dusdcType: appConfig.dusdcType,
      }),
  });
  const oracleOptionsQuery = useQuery({
    queryKey: ['buy-lane-oracle-options'],
    queryFn: getOracles,
    refetchInterval: 30_000,
  });
  const oracle = oracleQuery.data;
  const oracleOptions = useMemo(
    () => activeOracleChoices(oracleOptionsQuery.data ?? [], oracle?.underlyingAsset ?? 'BTC'),
    [oracleOptionsQuery.data, oracle?.underlyingAsset],
  );
  const managerOwnerQuery = useQuery({
    queryKey: ['buy-lane-manager-owner', oracle?.managerId],
    queryFn: () => {
      if (!oracle?.managerId) throw new Error('Missing manager id');
      return getManagerOwner(sui, oracle.managerId);
    },
    enabled: Boolean(oracle?.managerId),
  });
  const client = useMemo(
    () => new PredictClient(sui, appConfig.predictStudioPackage, oracle?.dbpPackage ?? appConfig.deepbookPredictPackage),
    [sui, oracle?.dbpPackage],
  );
  useEffect(() => {
    if (variant !== 'landing' || initialNote || target || !oracle) return;
    const preview = createIntentFallback({ prompt: defaultIntentPrompt(oracle), oracle });
    setTarget(preview.target);
    setEcho(preview.echo);
    setQuoteSource('Wallet-free preview');
  }, [initialNote, oracle, target, variant]);

  useEffect(() => {
    if (!oracle || !target) {
      setQuote(undefined);
      return;
    }
    let active = true;
    if (!isLiveOracleState(oracle)) {
      setQuoteSource('Oracle expired');
      setQuote(undefined);
      return;
    }

    const res = optimizeSparse(target, oracle.svi, oracle.forward);
    const legs = scaleLegsToTargetGross(res.best.legs, target);

    const quoteLeg = async (leg: Leg) => {
      if (account) {
        try {
          const ask = await client.quoteLeg(oracle, leg, account.address);
          setQuoteSource('devInspect live ask');
          return ask;
        } catch {
          setQuoteSource('AI intent sparse SVI estimate');
        }
      } else {
        setQuoteSource(variant === 'landing' ? 'Wallet-free preview' : 'AI intent sparse SVI estimate');
      }
      return legProb(oracle.svi, oracle.forward, leg) * leg.quantity;
    };

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
  }, [account, client, oracle, target, variant]);

  const chartSpot = oracle?.spot ?? 0;
  const strikeMarks = (quote?.legs ?? [])
    .flatMap((leg) => (leg.isRange ? [leg.lowerStrike, leg.higherStrike] : [leg.lowerStrike]))
    .filter((strike) => strike > 0);
  const chartLo = Math.min(chartSpot * 0.88, ...strikeMarks.map((strike) => strike - chartSpot * 0.05));
  const chartHi = Math.max(chartSpot * 1.12, ...strikeMarks.map((strike) => strike + chartSpot * 0.05));

  return (
    <main className="buy-shell">
      <header className="mb-5 grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="live-dot" aria-hidden />
            <span className="eyebrow">{variant === 'landing' ? 'DeepBook Predict' : 'Gasless buy lane'}</span>
          </div>
          <WalletControls />
        </div>
        <div>
          <h1 className="text-[2.3rem] sm:text-[2.7rem] leading-[1.0] tracking-tight">
            {variant === 'landing' ? (
              <>
                English in.
                <br />
                <span className="volt-text">Defined risk</span> out.
              </>
            ) : (
              <span className="brand-mark">Predict Studio</span>
            )}
          </h1>
          {variant === 'landing' ? (
            <>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed">{HACKATHON_SPINE}</p>
              <p className="mt-2 max-w-[46ch] text-[12.5px] leading-relaxed muted-text">{OPTIONS_GAP_WEDGE}</p>
              <Link
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] blue-text transition-opacity hover:opacity-80"
                href="/advanced"
              >
                Advanced builder
                <span aria-hidden>&rarr;</span>
              </Link>
            </>
          ) : null}
        </div>
      </header>
      <OraclePanel
        oracle={oracle}
        loading={oracleQuery.isLoading}
        error={oracleQuery.error instanceof Error ? oracleQuery.error.message : undefined}
        oracleOptions={oracleOptions}
        selectedOracleId={oracle?.oracleId ?? selectedOracleId}
        onOracleChange={(oracleId) => {
          setSelectedOracleId(oracleId);
          setQuote(undefined);
          setDigest(undefined);
          if (!initialNote) {
            setTarget(undefined);
            setEcho(undefined);
          }
        }}
        onRefresh={() => {
          void oracleQuery.refetch();
          void oracleOptionsQuery.refetch();
        }}
      />
      {oracle ? (
        <div className="grid gap-4">
          {variant === 'landing' ? (
            <>
              <div className="surface px-3 py-2 text-sm">
                <span className="metric-label mr-2">Wallet-free preview</span>
                <span>Type a view and see the payoff before connecting a wallet.</span>
              </div>
              <LiveProofStrip />
            </>
          ) : null}
          <IntentBar
            oracle={oracle}
            quote={quote}
            activeEcho={echo}
            onIntent={(intent) => {
              setTarget(intent.target);
              setEcho(intent.echo);
            }}
          />
          <TradingAccountPanel
            accountAddress={account?.address}
            client={client}
            oracle={oracle}
            managerOwner={managerOwnerQuery.data}
            depositAmount={quote?.totalCost}
            onManagerReady={setWalletManagerId}
          />
          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="metric-label">Payoff</div>
                <h2 className="text-lg font-semibold">At expiry</h2>
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
          {quote ? <NoteAnalyticsPanel legs={quote.legs} premium={quote.totalCost} oracle={oracle} /> : null}
          {quote ? <ReplicationProofPanel legs={quote.legs} premium={quote.totalCost} target={target} liveDigest={digest} /> : null}
          <StructureSummary quote={quote} quoteSource={quoteSource} />
          <ShareNoteButton echo={echo} target={target} quote={quote} />
          <MintButton
            client={client}
            oracle={oracle}
            legs={quote?.legs ?? []}
            shape="ai_intent"
            maxLossBudget={quote?.totalCost ?? 0}
            netMaxGain={quote?.maxGain}
            accountAddress={account?.address}
            managerOwner={managerOwnerQuery.data}
            disabled={!account || appConfig.predictStudioPackage === '0x0'}
            defaultGasless
            onMinted={setDigest}
          />
          {digest ? (
            <div className="surface break-all px-3 py-2 text-sm">
              <span className="metric-label mr-2">Digest</span>
              <span className="metric-value good-text">
                <ExplorerLink value={digest} />
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
