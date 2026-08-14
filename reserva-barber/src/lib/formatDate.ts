import { BUSINESS_TIME_ZONE } from '@/server/domain/models/businessTime';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Renders an instant as date and time in business local time (PC2).
 *
 * Formatted on the **server**, like everything else here: doing it in a Client
 * Component invites a hydration mismatch, because the build's locale data and
 * the browser's need not agree.
 *
 * Used for "last changed" on the Mercado Pago page, where the time of day
 * matters — it is one of the two facts that let an owner tell a completed
 * credential rotation from one whose outcome was never acknowledged, and two
 * saves on the same day are exactly when that question gets asked.
 */
export function formatDateTime(instant: Date): string {
  return `${DATE_FORMATTER.format(instant)} ${TIME_FORMATTER.format(instant)}`;
}

/**
 * Renders an absence for the list, in business local time.
 *
 * Formatted on the **server**. Doing it in a Client Component invites a
 * hydration mismatch, because the build's locale data and the browser's need
 * not agree — the same reasoning M3 applied to currency.
 *
 * The stored range is half-open, so a whole-day absence ends at 00:00 of the
 * following day. Showing that raw would tell the owner they are away on a day
 * they are not, so a whole-day range is rendered by its **last covered day**.
 */
export function formatTimeOffRange(startsAt: Date, endsAt: Date): string {
  const startsMidnight = isLocalMidnight(startsAt);
  const endsMidnight = isLocalMidnight(endsAt);

  if (startsMidnight && endsMidnight) {
    const lastDay = new Date(endsAt.getTime() - 1);
    const from = DATE_FORMATTER.format(startsAt);
    const to = DATE_FORMATTER.format(lastDay);
    return from === to ? from : `${from} – ${to}`;
  }

  const sameDay = DATE_FORMATTER.format(startsAt) === DATE_FORMATTER.format(endsAt);
  if (sameDay) {
    return `${DATE_FORMATTER.format(startsAt)}, ${TIME_FORMATTER.format(startsAt)}–${TIME_FORMATTER.format(endsAt)}`;
  }
  return `${DATE_FORMATTER.format(startsAt)} ${TIME_FORMATTER.format(startsAt)} – ${DATE_FORMATTER.format(endsAt)} ${TIME_FORMATTER.format(endsAt)}`;
}

/** Whether an instant falls exactly on local midnight — the whole-day marker. */
export function isLocalMidnight(instant: Date): boolean {
  return TIME_FORMATTER.format(instant) === '00:00';
}
