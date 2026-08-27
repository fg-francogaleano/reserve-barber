import Link from 'next/link';
import { COPY } from '@/lib/copy';
import {
  CALENDAR_DAY_PARAM,
  calendarDayHref,
} from '@/server/application/dashboard/barberCalendarParams';
import { addDays, formatLocalDate, type LocalDate } from '@/server/domain/models/bookingCalendar';

/**
 * Moving between days: three links and a GET form.
 *
 * **No `'use client'` and no date library.** `frontend-standards.md` names
 * `react-day-picker` for date selection, and that reference is about the public
 * flow's client-side needs. Here it would be the only client component on the
 * route — the page stops shipping zero JavaScript, the Worker pays bundle for
 * it (T51), and T44's list of `useActionState` forms gains nothing but company.
 * A native `<input type="date">` inside a GET form navigates on its own; this is
 * `RecentBookingsFilter`'s pattern, shipped and working.
 *
 * **Every link carries `prefetch={false}`, and the reason is weaker than
 * `StepLink`'s — stated here so nobody cites this as evidence of a measurement.**
 * That component's comment says "measured on `workerd`, not anticipated", and it
 * was: each prefetch on the booking flow fired a full catalogue read. This route
 * has a `loading.tsx`, and the App Router's default prefetch for a dynamic route
 * stops at the nearest loading boundary — so the database read almost certainly
 * does **not** fire here, and that has **not** been measured either way.
 *
 * What is left is a small, certain saving — an RSC payload request per link in
 * the viewport, for days the owner may never open, against a pool the public
 * booking flow shares (T47) — and consistency with the only other place in this
 * project that navigates between server-rendered reads. That is enough to keep
 * the prop. It is not enough to claim a round trip per hover, which is what an
 * earlier version of this comment did.
 */
export function DayNavigation({ barberId, date }: { barberId: string; date: LocalDate }) {
  const linkClass =
    'border-input hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium transition-colors';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <nav aria-label={COPY.barberCalendar.dayNavigation} className="flex flex-wrap gap-2">
        <Link
          href={calendarDayHref(barberId, addDays(date, -1))}
          prefetch={false}
          className={linkClass}
        >
          {COPY.barberCalendar.previousDay}
        </Link>
        {/*
          "Hoy" carries no parameter at all rather than today's date: the
          resolver's fallback is the business's current day, so an unparameterised
          link is always correct — including for somebody who leaves the tab open
          across midnight.
        */}
        <Link href={`/barberos/${barberId}/calendario`} prefetch={false} className={linkClass}>
          {COPY.barberCalendar.today}
        </Link>
        <Link
          href={calendarDayHref(barberId, addDays(date, 1))}
          prefetch={false}
          className={linkClass}
        >
          {COPY.barberCalendar.nextDay}
        </Link>
      </nav>

      <form method="get" className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="calendar-day" className="text-muted-foreground text-sm font-medium">
            {COPY.barberCalendar.pickDayLabel}
          </label>
          {/*
            No `min` or `max`. `frontend-standards.md` forbids both on any
            control: each lets the browser block the submission with a message in
            the browser's locale, from a string that exists nowhere in the copy
            module — so the validation the spec describes would not be the one
            the user meets. The range is enforced server-side by the resolver,
            which degrades an out-of-range day to today rather than refusing it.
          */}
          <input
            type="date"
            id="calendar-day"
            name={CALENDAR_DAY_PARAM}
            defaultValue={formatLocalDate(date)}
            className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          />
        </div>
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-4 text-sm font-medium transition-colors"
        >
          {COPY.barberCalendar.goToDay}
        </button>
      </form>
    </div>
  );
}
