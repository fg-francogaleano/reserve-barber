/**
 * The message that tells a client the shop cancelled their appointment (C2).
 *
 * **A pure function, like the confirmation builder**, and for the same reason:
 * the timezone, the money and the escaping are all testable here without a
 * transport, a clock or an environment.
 *
 * **This is the message N1 did not send.** `tech-debt.md` T72 records the
 * asymmetry it half-closes — a product that emails when nothing is wrong and
 * goes quiet when something is. Here the cause is not even a failure: the shop
 * decided, and the client has no other channel that reaches them.
 */

import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import { businessToday, formatSlotTime } from './bookingCalendar';
import { escapeHtml, headerSafe } from './emailText';
import type { EmailMessage } from '@/server/domain/repositories/IEmailSender';

/**
 * What the cancellation message needs.
 *
 * **Deliberately narrower than the confirmation's projection**, and the two
 * missing fields are the point: no `cancellationToken` and no `shopSlug`, so
 * this builder **cannot** compose a link even by accident.
 *
 * A cancelled booking has nothing for its client to do on the page, and that
 * link carries a cancellation token — a credential, which T69 records as
 * already living in one mailbox too many. Sending it where it has no use is
 * strictly worse than not sending it, and a type with no field for it is a
 * stronger guarantee than a rule somebody has to remember.
 *
 * The repository's existing projection is structurally assignable to this, so
 * the notice reuses that one read rather than adding a second.
 */
export interface CancellationEmailBooking {
  readonly clientName: string;
  readonly clientEmail: string;
  readonly shopName: string;
  readonly locationName: string;
  readonly barberName: string;
  readonly serviceName: string;
  readonly startTime: Date;
  /** A canonical decimal string, rendered only when it was actually charged. */
  readonly depositAmount: string;
}

export interface CancellationEmailInput {
  readonly booking: CancellationEmailBooking;
  /**
   * Whether a deposit was actually approved.
   *
   * Answered by the cancelling transaction, which is the only place it has no
   * race. **When false the message says nothing about money at all** — naming a
   * deposit nobody paid would invite a client to chase a refund for something
   * that never left their account.
   */
  readonly depositApproved: boolean;
}

const COPY_CANCEL = COPY.email.cancellation;

function appointmentLabel(startTime: Date): string {
  return `${formatBookingDateLong(businessToday(startTime))} · ${formatSlotTime(startTime)}`;
}

interface DetailRow {
  readonly label: string;
  readonly value: string;
}

function detailsOf(input: CancellationEmailInput): readonly DetailRow[] {
  const { booking } = input;

  const rows: DetailRow[] = [
    { label: COPY_CANCEL.whenLabel, value: appointmentLabel(booking.startTime) },
    { label: COPY_CANCEL.whereLabel, value: booking.locationName },
    { label: COPY_CANCEL.barberLabel, value: booking.barberName },
    { label: COPY_CANCEL.serviceLabel, value: booking.serviceName },
  ];

  if (input.depositApproved) {
    rows.push({
      label: COPY_CANCEL.depositLabel,
      value: formatCurrency(booking.depositAmount),
    });
  }

  return rows;
}

function renderText(input: CancellationEmailInput): string {
  const lines: string[] = [
    COPY_CANCEL.greeting(input.booking.clientName),
    '',
    COPY_CANCEL.heading,
    COPY_CANCEL.intro,
    '',
    ...detailsOf(input).map((row) => `${row.label}: ${row.value}`),
    '',
  ];

  if (input.depositApproved) {
    lines.push(COPY_CANCEL.depositNote, '');
  }

  lines.push(COPY_CANCEL.closing, '', input.booking.shopName);

  return lines.join('\n');
}

/**
 * The markup part. No remote asset, and — unlike the confirmation — **no
 * anchor at all**, because there is nowhere useful to send this reader.
 */
function renderHtml(input: CancellationEmailInput): string {
  const rows = detailsOf(input)
    .map(
      (row) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:4px 0;"><strong>${escapeHtml(row.value)}</strong></td></tr>`
    )
    .join('');

  const depositNote = input.depositApproved
    ? `<p>${escapeHtml(COPY_CANCEL.depositNote)}</p>`
    : '';

  return [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;">`,
    `<p>${escapeHtml(COPY_CANCEL.greeting(input.booking.clientName))}</p>`,
    `<h1 style="font-size:20px;margin:16px 0 8px;">${escapeHtml(COPY_CANCEL.heading)}</h1>`,
    `<p>${escapeHtml(COPY_CANCEL.intro)}</p>`,
    `<table cellpadding="0" cellspacing="0" border="0"><tbody>${rows}</tbody></table>`,
    depositNote,
    `<p>${escapeHtml(COPY_CANCEL.closing)}<br>${escapeHtml(input.booking.shopName)}</p>`,
    `</div>`,
  ].join('');
}

export function buildBookingCancellationEmail(input: CancellationEmailInput): EmailMessage {
  return {
    to: input.booking.clientEmail,
    subject: headerSafe(
      COPY_CANCEL.subject(
        headerSafe(input.booking.shopName),
        appointmentLabel(input.booking.startTime)
      )
    ),
    text: renderText(input),
    html: renderHtml(input),
  };
}
