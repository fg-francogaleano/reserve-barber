import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import {
  formatLocalDate,
  formatSlotTime,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import { minuteOfDayOf } from '@/server/domain/models/businessTime';

interface SlotStepProps {
  slug: string;
  locationId: string;
  serviceId: string;
  barberId: string;
  date: LocalDate;
  slots: readonly Date[];
  /** True when the chosen date is today, which changes what an empty list means. */
  isToday: boolean;
}

/**
 * Where the day breaks into readable groups.
 *
 * Presentation only: slot generation knows nothing about dayparts, and moving
 * these numbers changes headings, never which times are offered.
 */
const AFTERNOON_FROM_MINUTE = 12 * 60;
const EVENING_FROM_MINUTE = 19 * 60;

type Daypart = 'morning' | 'afternoon' | 'evening';

const DAYPART_LABELS: Record<Daypart, string> = {
  morning: COPY.booking.daypartMorning,
  afternoon: COPY.booking.daypartAfternoon,
  evening: COPY.booking.daypartEvening,
};

function daypartOf(slot: Date): Daypart {
  const minuteOfDay = minuteOfDayOf(slot);
  if (minuteOfDay < AFTERNOON_FROM_MINUTE) return 'morning';
  if (minuteOfDay < EVENING_FROM_MINUTE) return 'afternoon';
  return 'evening';
}

/**
 * The times a client may choose, grouped so a five-minute grid stays scannable.
 *
 * **The grid is five minutes by the owner's decision**, which maximises what can
 * be sold — a thirty-minute cancellation reopens six positions rather than one —
 * and costs density: a 9-to-18 day with a 30-minute service is 103 starts. That
 * is the ordinary case, not the stress case, so grouping by daypart is a
 * requirement of this step rather than a refinement of it (design D11).
 *
 * **Unavailable times are absent, never rendered.** Nothing here is greyed out
 * or struck through, and no state distinguishes a time taken by a booking from
 * one inside an absence or outside working hours. Rendering them would publish
 * a private person's agenda density and the shape of their days off to any
 * anonymous visitor holding the link — the same reasoning that made M5b confine
 * the absence `reason` structurally, one layer out.
 *
 * **Nothing here is held.** Two clients can be looking at the same time; the
 * truth is B4's transaction. The copy says so rather than implying a claim the
 * flow cannot make.
 */
export function SlotStep({
  slug,
  locationId,
  serviceId,
  barberId,
  date,
  slots,
  isToday,
}: SlotStepProps) {
  const backToDates = bookingStepHref(slug, { locationId, serviceId, barberId });

  if (slots.length === 0) {
    // Two different facts, and the client can act on the difference: "this day
    // is full" and "today is over" lead to the same next move but not to the
    // same understanding. Neither says which booking, absence or closed window
    // is responsible.
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-medium">
          {isToday ? COPY.booking.emptyToday : COPY.booking.emptyDay}
        </h2>
        <p className="text-muted-foreground">
          {isToday ? COPY.booking.emptyTodayHelp : COPY.booking.emptyDayHelp}
        </p>
        <StepLink href={backToDates} className="text-primary underline">
          {COPY.booking.back}
        </StepLink>
      </div>
    );
  }

  const groups: { daypart: Daypart; slots: Date[] }[] = [];
  for (const slot of slots) {
    const daypart = daypartOf(slot);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.daypart === daypart) {
      last.slots.push(slot);
    } else {
      groups.push({ daypart, slots: [slot] });
    }
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-medium">{COPY.booking.slotHeading}</h2>
        <p className="text-muted-foreground text-sm break-words">{formatBookingDateLong(date)}</p>
      </div>

      {groups.map((group) => (
        <div key={group.daypart} className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">
            {DAYPART_LABELS[group.daypart]}
          </h3>
          <ul className="flex flex-wrap gap-2">
            {group.slots.map((slot) => {
              const time = formatSlotTime(slot);
              return (
                <li key={time}>
                  <StepLink
                    href={bookingStepHref(slug, {
                      locationId,
                      serviceId,
                      barberId,
                      date: formatLocalDate(date),
                      time,
                    })}
                    className="border-border hover:bg-accent focus-visible:ring-ring flex min-h-11 min-w-16 items-center justify-center rounded-md border px-3 text-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {time}
                  </StepLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <StepLink href={backToDates} className="text-primary self-start text-sm underline">
        {COPY.booking.back}
      </StepLink>
    </section>
  );
}
