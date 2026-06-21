'use client';

import { AlertCircle, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { IntentResult } from '@/lib/ai-intent';
import { defaultIntentPrompt } from '@/lib/intent-state';
import { maxGain } from '@/lib/payoff';
import { USDC, type OracleState, type StructureQuote } from '@/lib/types';

function usd(value: number) {
  return `$${(value / USDC).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

async function requestIntent(prompt: string, oracle: OracleState): Promise<IntentResult> {
  const response = await fetch('/api/intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, oracle }),
  });
  const body = (await response.json().catch(() => undefined)) as (IntentResult & { error?: string }) | undefined;
  if (!response.ok) throw new Error(body?.error ?? 'intent generation failed');
  if (!body) throw new Error('intent generation failed');
  return body;
}

export function IntentBar({
  oracle,
  quote,
  activeEcho,
  onIntent,
}: {
  oracle: OracleState;
  quote?: StructureQuote;
  activeEcho?: string;
  onIntent: (intent: IntentResult) => void;
}) {
  const [prompt, setPrompt] = useState(() => defaultIntentPrompt(oracle));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [source, setSource] = useState<IntentResult['source']>();
  const grossPayout = quote ? maxGain(quote.legs, 0) : 0;

  const submit = async () => {
    if (!prompt.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await requestIntent(prompt, oracle);
      setSource(result.source);
      onIntent(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'intent generation failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel mt-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="metric-label">Intent</div>
          <h2 className="text-lg font-semibold">Plain-English builder</h2>
        </div>
        {source ? (
          <span className="surface inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] muted-text" title={source === 'anthropic' ? 'Your view was parsed by Claude' : 'Parsed locally by the deterministic rule engine (no API key set)'}>
            <Sparkles size={12} className={source === 'anthropic' ? 'volt-text' : 'muted-text'} />
            {source === 'anthropic' ? 'Parsed by Claude' : 'Rule-based parse'}
          </span>
        ) : (
          <Sparkles size={18} className="muted-text" />
        )}
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          className="control"
          value={prompt}
          placeholder="Example: BTC above 70k, payout $100"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        <button className="icon-button primary-button shrink-0" disabled={pending || !prompt.trim()} type="button" onClick={() => void submit()}>
          <Send size={16} />
          {pending ? 'Parsing' : 'Build preview'}
        </button>
      </div>
      {activeEcho ? (
        <div className="surface mt-3 grid gap-2 px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center">
          <span>Intent summary: {activeEcho}</span>
          {quote ? <span className="warn-text">Premium {usd(quote.totalCost)}</span> : null}
          {quote ? <span>Max loss {usd(quote.maxLoss)}</span> : null}
          {quote ? <span className="blue-text">Gross payout {usd(grossPayout)}</span> : null}
          {quote ? <span className="good-text">Net max gain {usd(quote.maxGain)}</span> : null}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 flex items-start gap-2 text-sm danger-text">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}
