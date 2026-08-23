'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/**
 * Copies one value to the clipboard.
 *
 * **Progressive enhancement, and nothing depends on it.** The value it copies
 * is already rendered as selectable text beside it, so a client with
 * JavaScript off — or one whose browser refuses clipboard access, which is
 * ordinary on an insecure origin or under a permission prompt — loses a
 * convenience and not the CBU.
 *
 * The failure is therefore swallowed rather than surfaced: telling somebody
 * "no pudimos copiar" beside a number they can select with their finger would
 * be noise about a problem they do not have.
 */
export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Long enough to be read, short enough that the control returns to its
      // ordinary state before the client looks again.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Deliberately silent. See above.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      // The visible label is one word for space; the accessible name says what
      // it copies, because "Copiar" alone is meaningless out of context.
      aria-label={`${COPY.booking.transferCopy} ${label}`}
    >
      {copied ? COPY.booking.transferCopied : COPY.booking.transferCopy}
    </Button>
  );
}
