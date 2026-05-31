'use client';

import { AlertCircle, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { IntentResult } from '@/lib/ai-intent';
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
  const [prompt, setPrompt] = useState('BTC stays between 90k and 110k through expiry');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (!prompt.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      onIntent(await requestIntent(prompt, oracle));
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
          <h2 className="text-base font-semibold">Market View</h2>
        </div>
        <Sparkles size={18} className="blue-text" />
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          className="control"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        <button className="icon-button primary-button shrink-0" disabled={pending || !prompt.trim()} type="button" onClick={() => void submit()}>
          <Send size={16} />
          {pending ? 'Parsing' : 'Build'}
        </button>
      </div>
      {activeEcho ? (
        <div className="surface mt-3 grid gap-2 px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
          <span>You're buying: {activeEcho}</span>
          {quote ? <span className="warn-text">Premium {usd(quote.totalCost)}</span> : null}
          {quote ? <span className="good-text">Max gain {usd(quote.maxGain)}</span> : null}
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
