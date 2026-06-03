'use client';

import { Link2 } from 'lucide-react';
import { useState } from 'react';
import {
  buildShareableBuyUrl,
  shareableNoteFromQuote,
  walrusSpecForShareableNote,
  type ShareableNote,
} from '@/lib/shareable-note';
import type { SparseTarget, StructureQuote } from '@/lib/types';

async function putWalrusSpec(note: ShareableNote): Promise<Pick<ShareableNote, 'blobId' | 'hash'>> {
  const response = await fetch('/api/walrus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(walrusSpecForShareableNote(note)),
  });
  if (!response.ok) throw new Error(`Walrus publish failed: ${response.status}`);
  return response.json() as Promise<Pick<ShareableNote, 'blobId' | 'hash'>>;
}

export function ShareNoteButton({
  echo,
  target,
  quote,
}: {
  echo?: string;
  target?: SparseTarget;
  quote?: StructureQuote;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const disabled = !echo || !target || pending;

  const share = async () => {
    if (!echo || !target) return;
    setPending(true);
    setError(undefined);
    try {
      const base = shareableNoteFromQuote({ echo, target, quote });
      const walrus = await putWalrusSpec(base);
      const next = buildShareableBuyUrl({ ...base, ...walrus }, window.location.origin);
      setUrl(next);
      await navigator.clipboard?.writeText(next).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Share failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2">
      <button className="icon-button w-full" disabled={disabled} type="button" onClick={() => void share()}>
        <Link2 size={16} />
        {pending ? 'Publishing' : 'Share note'}
      </button>
      {url ? <div className="surface break-all px-3 py-2 text-xs good-text">{url}</div> : null}
      {error ? <div className="surface px-3 py-2 text-xs danger-text">{error}</div> : null}
    </div>
  );
}
