import { localToInstant } from '@/server/domain/models/businessTime';
import { BUSINESS_TIME_ZONE } from '@/server/domain/models/businessTime';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';

/**
 * Rendering a calendar day for the booking flow, in es-AR.
 *
 * Formatted on the **server**, like every other formatter here: doing it in a
 * Client Component invites a hydration mismatch, because the build's locale data
 * and the browser's need not agree.
 *
 * A `LocalDate` carries no time, so each formatter converts it to that day's
 * local noon before formatting. Noon rather than midnight on purpose — midnight
 * is the instant a date-formatting bug lands on the wrong side of, and noon is
 * unambiguous in every timezone this could ever run in.
 */

const DAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
});

const FULL_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function middayOf(date: LocalDate): Date {
  return localToInstant({ ...date, minuteOfDay: 12 * 60 });
}

/** "17 ago" — the compact form the date strip uses. */
export function formatBookingDay(date: LocalDate): string {
  return DAY_FORMATTER.format(middayOf(date));
}

/** "lun" — the weekday above it. */
export function formatBookingWeekday(date: LocalDate): string {
  return WEEKDAY_FORMATTER.format(middayOf(date));
}

/** "lunes 17 de agosto" — the summary and the slot step's heading. */
export function formatBookingDateLong(date: LocalDate): string {
  return FULL_FORMATTER.format(middayOf(date));
}
