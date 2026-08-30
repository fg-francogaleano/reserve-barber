/**
 * The reminder message, composed from a booking and nothing else.
 *
 * **A pure function, for the reason `bookingConfirmationEmail` gives about
 * itself**: everything here worth getting right — the timezone, the integer-cent
 * arithmetic, the escaping, the branch where no origin resolves — is testable
 * without a transport, a clock or an environment. That matters more here than
 * it did there, because the caller is a scheduled job nobody watches.
 *
 * **A separate function rather than a `kind` on the confirmation's builder.**
 * The two messages carry the same fields and do different jobs: one is a
 * receipt for money that moved, the other is a prompt to act while acting is
 * still useful. A boolean switching subject, heading, intro and link wording is
 * a function whose every reader has to hold both messages in mind, and the
 * first divergence adds a second boolean. Sharing stops at the helpers, which
 * is the level where sharing is safe — the same place N1 drew the line when it
 * kept escaping in the domain rather than in the adapter.
 *
 * **What differs from the confirmation, and it is only the words.** The link is
 * the same link to the same page. What changes is why it is offered: a day
 * before the appointment the useful action is releasing a slot the shop can
 * still sell, so the copy leads with that instead of mentioning it last.
 */

import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import { businessToday, formatSlotTime } from './bookingCalendar';
import { fromCents, toCents } from './money';
import { escapeHtml, headerSafe } from './emailText';
import type { EmailMessage } from '@/server/domain/repositories/IEmailSender';

/**
 * What the message needs, and deliberately not one field more.
 *
 * Structurally identical to `ConfirmationEmailBooking` and declared separately
 * rather than imported, because the two are the same **today** and nothing
 * requires them to stay so. Importing it would make a field added for the
 * confirmation silently available here, which is how a projection widens
 * without anybody deciding to widen it.
 *
 * No phone, no booking id, no owner id — the same three refusals the
 * confirmation's projection makes, and here the read behind it is unscoped by
 * owner, which makes the discipline load-bearing rather than tidy.
 */
export interface ReminderEmailBooking {
  readonly clientName: string;
  readonly clientEmail: string;
  readonly shopName: string;
  readonly shopSlug: string;
  readonly locationName: string;
  readonly locationAddress: string | null;
  readonly barberName: string;
  readonly serviceName: string;
  readonly startTime: Date;
  /** Canonical decimal strings, as every money value crosses the boundary. */
  readonly priceAtBooking: string;
  readonly depositAmount: string;
  readonly cancellationToken: string;
}

export interface ReminderEmailInput {
  readonly booking: ReminderEmailBooking;
  /**
   * The deployment's public origin, already checked for reachability, or
   * `null` when none resolves.
   *
   * **`null` removes the link and sends the message anyway**, exactly as the
   * confirmation does — but the loss is larger here and the capability says so.
   * A confirmation without a link is still a receipt for money that moved; a
   * reminder without one has had its purpose removed and leaves the client
   * where they were before it arrived. It is still better than silence, and the
   * alternative — a relative URL or a loopback address — puts an unusable link
   * in an inbox where it can never be corrected.
   */
  readonly origin: string | null;
}

const COPY_EMAIL = COPY.email.reminder;

/**
 * What is left to pay at the shop, in integer cents.
 *
 * **Cents, never floats.** `9000.00 - 2000.50` in binary floating point is not
 * the number a person would write down, and this value is printed in a message
 * that cannot be corrected after it is sent. `toCents`/`fromCents` are the pair
 * every other money decision in this product goes through.
 *
 * Returns `null` when nothing is left, so the caller omits the line entirely: a
 * message stating "$ 0,00 a pagar en el local" reads as a mistake rather than
 * as good news.
 */
function balanceOf(booking: ReminderEmailBooking): string | null {
  const cents = toCents(booking.priceAtBooking) - toCents(booking.depositAmount);
  return cents > 0 ? fromCents(cents) : null;
}

/**
 * The booking page's own address — the same page the confirmation linked to.
 *
 * The token is percent-encoded even though it is generated URL-safe: the
 * encoding is a property of composing a URL, not a fact about today's token
 * alphabet.
 */
function bookingUrl(origin: string, booking: ReminderEmailBooking): string {
  const slug = encodeURIComponent(booking.shopSlug);
  const token = encodeURIComponent(booking.cancellationToken);
  return `${origin}/b/${slug}/reserva/${token}`;
}

/**
 * The appointment, business-local, in one expression used by both parts and the
 * subject.
 *
 * Through the shared calendar module rather than a second `Intl` call written
 * here: the booking domain records that a second expression of a rule which
 * reads a clock drifts from the first.
 */
function appointmentLabel(startTime: Date): string {
  return `${formatBookingDateLong(businessToday(startTime))} · ${formatSlotTime(startTime)}`;
}

interface DetailRow {
  readonly label: string;
  readonly value: string;
}

function detailsOf(booking: ReminderEmailBooking): readonly DetailRow[] {
  const balance = balanceOf(booking);

  const rows: DetailRow[] = [
    { label: COPY_EMAIL.whenLabel, value: appointmentLabel(booking.startTime) },
    { label: COPY_EMAIL.whereLabel, value: booking.locationName },
  ];

  if (booking.locationAddress !== null && booking.locationAddress.length > 0) {
    rows.push({ label: COPY_EMAIL.addressLabel, value: booking.locationAddress });
  }

  rows.push(
    { label: COPY_EMAIL.barberLabel, value: booking.barberName },
    { label: COPY_EMAIL.serviceLabel, value: booking.serviceName },
    { label: COPY_EMAIL.depositLabel, value: formatCurrency(booking.depositAmount) }
  );

  if (balance !== null) {
    rows.push({ label: COPY_EMAIL.balanceLabel, value: formatCurrency(balance) });
  }

  return rows;
}

/**
 * The plain-text part.
 *
 * Not a courtesy. Some clients strip markup, forwards degrade, and a link that
 * exists only as a styled control disappears in every one of those cases — so
 * the URL is printed here as readable text on a line of its own.
 */
function renderText(booking: ReminderEmailBooking, url: string | null): string {
  const lines: string[] = [
    COPY_EMAIL.greeting(booking.clientName),
    '',
    COPY_EMAIL.heading,
    COPY_EMAIL.intro,
    '',
    ...detailsOf(booking).map((row) => `${row.label}: ${row.value}`),
    '',
  ];

  if (url === null) {
    lines.push(COPY_EMAIL.noLink);
  } else {
    lines.push(COPY_EMAIL.linkIntro, url);
  }

  lines.push('', COPY_EMAIL.closing, booking.shopName);

  return lines.join('\n');
}

/**
 * The markup part.
 *
 * **No remote asset of any kind** — no image, no stylesheet, no web font.
 * Images are blocked by default in most clients, so a message that depends on
 * one arrives broken, and a remote asset in an email is a tracking pixel
 * whether or not anybody meant it to be. Styling is inline and minimal, and the
 * message reads correctly with every style discarded.
 */
function renderHtml(booking: ReminderEmailBooking, url: string | null): string {
  const rows = detailsOf(booking)
    .map(
      (row) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:4px 0;"><strong>${escapeHtml(row.value)}</strong></td></tr>`
    )
    .join('');

  const linkBlock =
    url === null
      ? `<p>${escapeHtml(COPY_EMAIL.noLink)}</p>`
      : // The URL twice on purpose: once as the control, once as readable text
        // that survives a forward, a plain-text render and a copy-paste.
        `<p>${escapeHtml(COPY_EMAIL.linkIntro)}</p>` +
        `<p><a href="${escapeHtml(url)}">${escapeHtml(COPY_EMAIL.linkLabel)}</a></p>` +
        `<p style="word-break:break-all;color:#666;">${escapeHtml(url)}</p>`;

  return [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;">`,
    `<p>${escapeHtml(COPY_EMAIL.greeting(booking.clientName))}</p>`,
    `<h1 style="font-size:20px;margin:16px 0 8px;">${escapeHtml(COPY_EMAIL.heading)}</h1>`,
    `<p>${escapeHtml(COPY_EMAIL.intro)}</p>`,
    `<table cellpadding="0" cellspacing="0" border="0"><tbody>${rows}</tbody></table>`,
    linkBlock,
    `<p>${escapeHtml(COPY_EMAIL.closing)}<br>${escapeHtml(booking.shopName)}</p>`,
    `</div>`,
  ].join('');
}

export function buildBookingReminderEmail(input: ReminderEmailInput): EmailMessage {
  const { booking, origin } = input;
  const url = origin === null ? null : bookingUrl(origin, booking);

  return {
    to: booking.clientEmail,
    // The client's name is nowhere in here. The shop's name is owner-supplied
    // and still passes through `headerSafe`, because a header is a header.
    subject: headerSafe(
      COPY_EMAIL.subject(headerSafe(booking.shopName), appointmentLabel(booking.startTime))
    ),
    text: renderText(booking, url),
    html: renderHtml(booking, url),
  };
}
