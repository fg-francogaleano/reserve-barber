import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import {
  formatSlotTime,
  businessToday as businessDateOf,
} from '@/server/domain/models/bookingCalendar';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import type { ReviewableReceipt } from '@/server/application/services/ReceiptReviewService';
import { receiptReviewService } from './receiptReviewService';
import { ReceiptDecision } from './ReceiptDecision';

/**
 * The owner's queue of transfer receipts awaiting an answer.
 *
 * **Never cached and never indexed.** Every row names a client and an
 * appointment, and each carries a signed URL that is a bearer credential for
 * somebody's bank document — a cached render would hand one to whoever asked
 * next.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

async function fetchPending(ownerId: string): Promise<readonly ReviewableReceipt[]> {
  try {
    return await (await receiptReviewService()).listPending(ownerId);
  } catch (error) {
    logger.error('Failed to load pending receipts', toErrorLogContext('receipts.list', error));
    throw error;
  }
}

export default async function ReceiptsPage() {
  const owner = await requireOwner();
  const pending = await fetchPending(owner.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.receipts.heading}</h1>
        {/*
          The instruction, and the only honest framing of it. Nothing in this
          product verifies that a transfer happened, so the page tells the owner
          what they have to do rather than implying the system already did it.
        */}
        <p className="text-muted-foreground text-sm">{COPY.receipts.intro}</p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-1 py-8 text-center">
            <p className="text-sm font-medium">{COPY.receipts.emptyState}</p>
            <p className="text-muted-foreground text-sm">{COPY.receipts.emptyStateHelp}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((receipt) => (
            <li key={receipt.receiptId}>
              <ReceiptCard receipt={receipt} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ReceiptCard({ receipt }: { receipt: ReviewableReceipt }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base break-words">
          {formatBookingDateLong(businessDateOf(receipt.startTime))} ·{' '}
          {formatSlotTime(receipt.startTime)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <Row
            label={COPY.receipts.appointmentLabel}
            value={`${receipt.serviceName} · ${receipt.barberDisplayName} · ${receipt.locationName}`}
          />
          <Row label={COPY.receipts.clientLabel} value={receipt.clientName} />
          {/*
            The figure the owner compares against their bank statement. It is
            the booking's snapshot, and it is the only thing on this page that
            makes the comparison possible at all — without it, approving is a
            guess.
          */}
          <Row
            label={COPY.receipts.amountLabel}
            value={formatCurrency(receipt.depositAmount)}
            emphasis
          />
        </dl>

        {receipt.fileUrl === null ? (
          // A storage hiccup must not empty a queue the owner needs to work
          // through. The row keeps everything except the file, and says so.
          <p className="text-muted-foreground text-sm">{COPY.receipts.fileUnavailable}</p>
        ) : (
          <p className="text-sm">
            {/*
              The signature is generated on this render and is short-lived. The
              response is forced to download rather than render inline: a PDF
              can carry active content, and the alternative is executing a
              stranger's file against the storage origin in the owner's own
              browser.
            */}
            <a
              href={receipt.fileUrl}
              className="text-primary font-medium underline-offset-4 hover:underline"
              rel="noopener noreferrer"
            >
              {COPY.receipts.openFile}
            </a>{' '}
            <span className="text-muted-foreground">{COPY.receipts.openFileHelp}</span>
          </p>
        )}

        <ReceiptDecision receiptId={receipt.receiptId} />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`break-words ${emphasis ? 'text-base font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
