/**
 * The confirmation message, composed from a booking and nothing else.
 *
 * **A pure function, and the reason is the same one `resolvePaymentPageState`
 * gives about itself.** Everything here that is worth getting right — the
 * timezone, the integer-cent arithmetic, the escaping, the branch where no
 * origin resolves — is testable without a transport double, a clock or an
 * environment. The adapter that sends this is then left with one job, which is
 * the job it can be reviewed for.
 *
 * **Escaping lives here rather than in the adapter**, because the adapter is
 * where somebody later adds a second message type and forgets.
 *
 * It reads its Spanish from `COPY` like every other user-facing string. The
 * literals there are trusted; every interpolated value is guest- or
 * owner-supplied and is escaped at assembly.
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
 * No phone: the projection behind this does not select it, and a shape that
 * cannot hold it cannot render it by accident — the same argument the
 * confirmation page's own projection makes.
 *
 * No booking id and no owner id. Neither belongs in front of a client, and
 * `data-model.md` records that the owner id never reaches a rendering layer.
 */
export interface ConfirmationEmailBooking {
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

export interface ConfirmationEmailInput {
  readonly booking: ConfirmationEmailBooking;
  /**
   * The deployment's public origin, already checked for reachability, or
   * `null` when none resolves.
   *
   * **`null` removes the link and sends the message anyway.** A client who paid
   * is owed the confirmation regardless, and the alternative — emitting a
   * relative URL or a loopback address — puts an unusable link in an inbox
   * where it can never be corrected.
   */
  readonly origin: string | null;
}

const COPY_EMAIL = COPY.email.confirmation;

/**
 * What is left to pay at the shop, in integer cents.
 *
 * **Cents, never floats.** `7000.10 - 0.60` in binary floating point is
 * `6999.499999999999`, and this value is printed in a message that cannot be
 * corrected after it is sent. `toCents`/`fromCents` are the same pair every
 * other money decision in this product goes through.
 *
 * Returns `null` when nothing is left, so the caller omits the line entirely: a
 * message stating "$ 0,00 a pagar en el local" reads as a mistake rather than
 * as good news.
 */
function balanceOf(booking: ConfirmationEmailBooking): string | null {
  const cents = toCents(booking.priceAtBooking) - toCents(booking.depositAmount);
  return cents > 0 ? fromCents(cents) : null;
}

/**
 * The booking page's own address.
 *
 * The token is percent-encoded even though it is generated URL-safe: the
 * encoding is a property of composing a URL, not a fact about today's token
 * alphabet, and the confirmation page bounds the segment it receives.
 */
function bookingUrl(origin: string, booking: ConfirmationEmailBooking): string {
  const slug = encodeURIComponent(booking.shopSlug);
  const token = encodeURIComponent(booking.cancellationToken);
  return `${origin}/b/${slug}/reserva/${token}`;
}

/**
 * The appointment, business-local, in one expression used by both parts and the
 * subject.
 *
 * Through the shared calendar module rather than a second `Intl` call written
 * here: the booking domain already records that a second expression of a rule
 * which reads a clock drifts from the first.
 */
function appointmentLabel(startTime: Date): string {
  return `${formatBookingDateLong(businessToday(startTime))} · ${formatSlotTime(startTime)}`;
}

interface DetailRow {
  readonly label: string;
  readonly value: string;
}

function detailsOf(booking: ConfirmationEmailBooking): readonly DetailRow[] {
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
 * the URL is printed here as readable text.
 */
function renderText(booking: ConfirmationEmailBooking, url: string | null): string {
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
 * one is a message that arrives broken, and a remote asset in an email is a
 * tracking pixel whether or not anybody meant it to be. Styling is inline and
 * minimal, and the message reads correctly with every style discarded.
 */
function renderHtml(booking: ConfirmationEmailBooking, url: string | null): string {
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

export function buildBookingConfirmationEmail(input: ConfirmationEmailInput): EmailMessage {
  const { booking, origin } = input;
  const url = origin === null ? null : bookingUrl(origin, booking);

  return {
    to: booking.clientEmail,
    subject: headerSafe(
      COPY_EMAIL.subject(headerSafe(booking.shopName), appointmentLabel(booking.startTime))
    ),
    text: renderText(booking, url),
    html: renderHtml(booking, url),
  };
}
