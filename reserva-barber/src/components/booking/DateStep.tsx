import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import {
  addDays,
  formatLocalDate,
  weekdayOfLocalDate,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { MAX_BOOKING_HORIZON_DAYS } from '@/server/domain/models/bookingHorizon';
import { formatBookingDay, formatBookingWeekday } from '@/lib/formatBookingDate';
import type { Weekday } from '@/server/domain/models/weekday';

interface DateStepProps {
  slug: string;
  locationId: string;
  serviceId: string;
  barberId: string;
  today: LocalDate;
  /** The weekdays this barber works at all. Not which days have free times. */
  workingWeekdays: ReadonlySet<Weekday>;
}

/**
 * The strip of bookable days, from today to the horizon.
 *
 * **A day the barber does not work is shown, not hidden** — the client needs to
 * see that Sundays are closed rather than wonder why a date vanished from a
 * sequence. It is announced as unavailable rather than merely styled, because a
 * greyed-out control is invisible to a screen reader.
 *
 * **A day that has working hours but nothing free is still selectable**, and
 * resolves to the slot step's empty state. That is deliberate (design D8):
 * answering it here would mean one full availability computation per day in the
 * horizon — sixty of them — on the route with neither a cache nor a rate limit.
 * The cost is one honest extra tap on a day that turns out to be full; the
 * alternative is sixty queries to draw a strip.
 *
 * Every link goes through `StepLink`, so the router does not prefetch sixty
 * availability reads as the strip scrolls into view.
 */
export function DateStep({
  slug,
  locationId,
  serviceId,
  barberId,
  today,
  workingWeekdays,
}: DateStepProps) {
  const days = Array.from({ length: MAX_BOOKING_HORIZON_DAYS + 1 }, (_, offset) =>
    addDays(today, offset)
  );

  if (workingWeekdays.size === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-medium">{COPY.booking.emptyHorizon}</h2>
        <p className="text-muted-foreground">{COPY.booking.emptyHorizonHelp}</p>
        <StepLink
          href={bookingStepHref(slug, { locationId, serviceId })}
          className="text-primary underline"
        >
          {COPY.booking.back}
        </StepLink>
      </div>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-xl font-medium">{COPY.booking.dateHeading}</h2>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {days.map((day) => {
          const iso = formatLocalDate(day);
          const label = formatBookingDay(day);
          const worksThisDay = workingWeekdays.has(weekdayOfLocalDate(day));

          if (!worksThisDay) {
            return (
              <li key={iso}>
                <span
                  aria-disabled="true"
                  className="border-border text-muted-foreground flex min-w-0 flex-col rounded-md border border-dashed p-3 text-sm"
                >
                  <span className="sr-only">{COPY.booking.dayUnavailable(label)}</span>
                  <span aria-hidden="true" className="font-medium break-words">
                    {formatBookingWeekday(day)}
                  </span>
                  <span aria-hidden="true" className="break-words">
                    {label}
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={iso}>
              <StepLink
                href={bookingStepHref(slug, { locationId, serviceId, barberId, date: iso })}
                className="border-border hover:bg-accent focus-visible:ring-ring flex min-w-0 flex-col rounded-md border p-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="font-medium break-words">{formatBookingWeekday(day)}</span>
                <span className="text-muted-foreground break-words">{label}</span>
              </StepLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
