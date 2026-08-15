'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

type CopyOutcome = 'idle' | 'copied' | 'failed';

/**
 * Whether a clipboard exists, read without desynchronising the two renders.
 *
 * `navigator.clipboard` is absent on the server and outside a secure context, so
 * reading it during render would make the server emit one tree and the client
 * another. `useSyncExternalStore` is the API for exactly this: it takes a
 * separate server snapshot, so the button is absent in the HTML and appears on
 * hydration, with no mismatch and no state written from an effect.
 *
 * Hoisted to module scope so the identities are stable and React does not
 * resubscribe on every render.
 */
const NEVER_CHANGES = (): (() => void) => () => {};
const clipboardOnClient = (): boolean =>
  typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
const clipboardOnServer = (): boolean => false;

/**
 * The link the owner shares, with a copy control.
 *
 * The URL arrives already composed, from the server. Building it here from
 * `window.location.origin` would leave it undefined during server rendering and
 * produce a hydration mismatch on first paint — on the one page whose output the
 * owner is about to copy and hand to their clients (design D11).
 */
export function ShareableLink({ url }: { url: string }) {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle');
  const canCopy = useSyncExternalStore(NEVER_CHANGES, clipboardOnClient, clipboardOnServer);

  useEffect(() => {
    if (outcome === 'idle') return;
    const timer = setTimeout(() => setOutcome('idle'), 4000);
    return () => clearTimeout(timer);
  }, [outcome]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setOutcome('copied');
    } catch {
      // A refusal is a real outcome the owner has to know about: the link is
      // still selectable, and silence would look like a successful copy.
      setOutcome('failed');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-sm break-all select-all">
          {url}
        </p>
        {canCopy ? (
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {COPY.businessProfile.linkCopy}
          </Button>
        ) : null}
      </div>

      {/* Always present so the announcement is made by a region that already
          exists, rather than by one appearing at the same moment. */}
      <p role="status" aria-live="polite" className="text-muted-foreground min-h-4 text-xs">
        {outcome === 'copied' ? COPY.businessProfile.linkCopied : null}
        {outcome === 'failed' ? COPY.businessProfile.linkCopyFailed : null}
      </p>

    </div>
  );
}
