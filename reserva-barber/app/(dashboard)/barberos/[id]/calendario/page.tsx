import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import { formatSlotTime, type LocalDate } from '@/server/domain/models/bookingCalendar';
import {
  CALENDAR_DAY_PARAM,
  resolveCalendarDay,
} from '@/server/application/dashboard/barberCalendarParams';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import type { AbsenceOnDay, CalendarEntry } from '@/server/domain/models/barberCalendarDay';
import type { BarberCalendarView } from '@/server/application/services/BarberCalendarService';
import type { Interval } from '@/server/domain/models/availability';
import { barberCalendarService } from './barberCalendarService';
import { DayNavigation } from './DayNavigation';

/**
 * One barber's day (D3).
 *
 * **Never cached and never indexed.** It reads a session and names clients, so
 * a cached render would hand one owner's day to whoever asked next — the same
 * reason the dashboard home and the receipt queue carry both.
 *
 * **No client JavaScript.** Every component here is a Server Component, the two
 * interactions are links and a GET form that navigates, and all `Intl`
 * formatting happens on the server: formatting a time on both sides of the
 * render boundary is how a hydration mismatch happens.
 *
 * **Read-only.** C2 ships owner cancellation on the dashboard home; a story
 * whose verb is *visualize* does not become the second writer of a guarded
 * transition.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** What the page renders: the day, or the fact that it could not be read. */
type PageState =
  | { readonly ok: true; readonly view: BarberCalendarView }
  | { readonly ok: false; readonly date: LocalDate; readonly today: LocalDate };

/**
 * What the read produced. Three outcomes, because "this barber is not yours"
 * and "the database did not answer" are different answers that must not
 * collapse into one nullable value.
 */
type ReadOutcome =
  | { readonly kind: 'found'; readonly view: BarberCalendarView }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

export default async function BarberCalendarPage({ params, searchParams }: PageProps) {
  // Guarded in its own right, not only by the middleware and the layout: this
  // page reads the database, and that read must never start for a request
  // without a session. `requireOwner()` is request-cached, so it costs nothing.
  const owner = await requireOwner();

  const [{ id }, raw] = await Promise.all([params, searchParams]);

  const service = barberCalendarService();
  const today = service.today();
  const date = resolveCalendarDay(raw[CALENDAR_DAY_PARAM], today);

  let outcome: ReadOutcome;
  try {
    const view = await service.dayFor({ barberId: id, ownerId: owner.id, date });
    outcome = view === null ? { kind: 'missing' } : { kind: 'found', view };
  } catch (error) {
    // The context carries an operation and an error name — never the barber,
    // never a client, never the submitted parameter.
    logger.error('Failed to load barber calendar', toErrorLogContext('loadBarberCalendar', error));
    outcome = { kind: 'failed' };
  }

  // **Outside the `try`, deliberately.** `notFound()` signals by throwing, so
  // calling it inside would be caught by the handler above and a 404 would
  // render as "no pudimos cargar el calendario" — a failure message for a
  // barber that does not exist. Three outcomes rather than a nullable view for
  // the same reason: "not yours" and "could not read" are different answers and
  // the type should not let them collapse.
  if (outcome.kind === 'missing') notFound();

  const state: PageState =
    outcome.kind === 'found' ? { ok: true, view: outcome.view } : { ok: false, date, today };

  const heading = state.ok
    ? COPY.barberCalendar.heading(state.view.barber.displayName)
    : COPY.barberCalendar.headingUnknown;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight break-words">{heading}</h1>
        {state.ok ? (
          <p className="text-muted-foreground text-sm">{state.view.barber.locationName}</p>
        ) : null}
      </header>

      <DayNavigation barberId={id} date={date} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-semibold tracking-tight first-letter:uppercase">
            {formatBookingDateLong(date)}
          </h2>
          {isPast(date, state.ok ? state.view.today : state.today) ? (
            <span className="text-muted-foreground text-xs">{COPY.barberCalendar.pastDay}</span>
          ) : null}
        </div>

        {state.ok ? <Day view={state.view} barberId={id} /> : <LoadFailed />}
      </section>
    </main>
  );
}

/**
 * The read failed, and the page says so.
 *
 * **Zero and failure never render alike** (D1's rule), and the failure belongs
 * inside the page rather than in the route's error boundary: reaching that
 * would replace the whole page, including the day navigation the owner would
 * use to retry.
 */
function LoadFailed() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm font-medium">{COPY.barberCalendar.loadFailed}</p>
        <p className="text-muted-foreground text-sm">{COPY.barberCalendar.loadFailedHelp}</p>
      </CardContent>
    </Card>
  );
}

function Day({ view, barberId }: { view: BarberCalendarView; barberId: string }) {
  const { day } = view;

  // **Two empty states, never one.** "Does not work this day" and "works and
  // nothing is booked" are opposite facts; sharing a message would make a
  // configured schedule look like a missing one and send the owner to fix
  // something that is not broken.
  if (day.workingIntervals.length === 0 && day.occupying.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.barberCalendar.noSchedule}</p>
          <p className="text-muted-foreground text-sm">{COPY.barberCalendar.noScheduleHint}</p>
          <Link
            href={`/barberos/${barberId}/horarios`}
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.barberCalendar.manageSchedule}
          </Link>
          {day.recorded.length > 0 ? <Recorded entries={day.recorded} /> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Appointments entries={day.occupying} hint={emptyDayHint(day)} />
      <FreeTime intervals={day.freeIntervals} absences={day.absences} />
      {day.recorded.length > 0 ? <Recorded entries={day.recorded} /> : null}
    </div>
  );
}

/**
 * What to say beneath "sin turnos", on a day that has working hours.
 *
 * **Three answers, because one of them was a lie.** "El horario está libre de
 * punta a punta" is true only of a day nothing else touches; on a day an
 * absence covers entirely it contradicts the free-time region directly below
 * it, which says there is none. Found by driving the page, not by a test — both
 * sentences were individually correct and only their combination was false.
 *
 * When an absence merely dents the day, there is no short sentence that is both
 * true and useful, so nothing is said: the free-time chips below already state
 * exactly what is left.
 */
function emptyDayHint(day: BarberCalendarView['day']): string | null {
  if (day.absences.length === 0) return COPY.barberCalendar.emptyDayHint;
  if (day.freeIntervals.length === 0) return COPY.barberCalendar.emptyDayAway;
  return null;
}

function Appointments({
  entries,
  hint,
}: {
  entries: readonly CalendarEntry[];
  hint: string | null;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.barberCalendar.emptyDay}</p>
          {hint !== null ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold tracking-tight">
        {COPY.barberCalendar.appointmentsHeading}
      </h3>
      {/*
        An ordered list of time-bearing rows rather than a positioned grid: the
        owner opens this on a phone between clients, and density has to degrade
        into scrolling rather than into overlap.
      */}
      <ul aria-label={COPY.barberCalendar.appointmentsHeading} className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.appointment.id}>
            <AppointmentRow entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppointmentRow({ entry }: { entry: CalendarEntry }) {
  const { appointment, presence, outsideWorkingHours } = entry;
  const canceller = presence === 'cancelled' ? cancellerLabel(appointment.cancelledBy) : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        {/* T18: min-w-0 on BOTH levels, or a long unbroken name refuses to
            shrink below its intrinsic width and `break-words` never acts. */}
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">
            {COPY.barberCalendar.range(
              formatSlotTime(appointment.startTime),
              formatSlotTime(appointment.endTime)
            )}
          </span>
          {/* Text, never colour alone. */}
          <span className="text-muted-foreground shrink-0 text-xs">
            {COPY.barberCalendar.presence[presence]}
          </span>
        </div>
        <p className="min-w-0 text-sm break-words">{appointment.clientName}</p>
        <p className="text-muted-foreground min-w-0 text-sm break-words">
          {appointment.serviceName}
        </p>
        {outsideWorkingHours ? (
          <p className="text-destructive text-sm">
            {COPY.barberCalendar.outsideHours}
            <span className="text-muted-foreground block text-xs">
              {COPY.barberCalendar.outsideHoursHint}
            </span>
          </p>
        ) : null}
        {canceller !== null ? (
          <p className="text-muted-foreground text-xs">{canceller}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Who cancelled, when the row records it — and `null` when nothing does.
 *
 * A null actor is every booking written before C2 gave the column a writer.
 * The row's presence label already reads "Cancelado", so there is nothing to
 * add: a second line repeating the word is noise, and any wording that named
 * an actor would be inventing one. That is the same restraint the client's own
 * page applies to the same rows.
 */
function cancellerLabel(cancelledBy: 'OWNER' | 'CLIENT' | null): string | null {
  if (cancelledBy === 'OWNER') return COPY.barberCalendar.cancelledByOwner;
  if (cancelledBy === 'CLIENT') return COPY.barberCalendar.cancelledByClient;
  return null;
}

/**
 * The time nothing occupies, and the absences that removed some of it.
 *
 * **"Libre", not "disponible".** This is free *time*, not a bookable slot: a
 * slot needs a service's duration and a lead time, and neither exists on this
 * page. `generateSlots` is deliberately not called here.
 */
/**
 * What an absence may be said to be, on this day.
 *
 * **The exhaustive switch is the point.** The domain decides which of the four
 * sentences is true — an absence spanning three days has no start time on its
 * middle day worth showing — and this only picks the words. Formatting the two
 * instants directly is what made the page claim a three-day absence lasted from
 * 10:00 to 18:00.
 */
function absenceLabel(absence: AbsenceOnDay): string {
  switch (absence.kind) {
    case 'wholeDay':
      return COPY.barberCalendar.absenceWholeDay;
    case 'untilTime':
      return COPY.barberCalendar.absenceUntil(formatSlotTime(absence.end));
    case 'fromTime':
      return COPY.barberCalendar.absenceFrom(formatSlotTime(absence.start));
    case 'between':
      return COPY.barberCalendar.range(
        formatSlotTime(absence.start),
        formatSlotTime(absence.end)
      );
  }
}

function FreeTime({
  intervals,
  absences,
}: {
  intervals: readonly Interval[];
  absences: readonly AbsenceOnDay[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{COPY.barberCalendar.freeHeading}</h3>
      {intervals.length === 0 ? (
        <p className="text-muted-foreground text-sm">{COPY.barberCalendar.noFreeTime}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {intervals.map((interval) => (
            <li
              key={interval.start.toISOString()}
              className="text-muted-foreground rounded-md border px-3 py-1.5 text-sm"
            >
              {COPY.barberCalendar.range(
                formatSlotTime(interval.start),
                formatSlotTime(interval.end)
              )}
            </li>
          ))}
        </ul>
      )}
      {absences.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {absences.map((absence, index) => (
            <li
              // An absence has no identity in this projection — deliberately,
              // since it carries no id and no reason — and two of them can share
              // a shape, so the position in a list the domain already ordered is
              // the only stable key available.
              key={index}
              className="text-muted-foreground rounded-md border border-dashed px-3 py-1.5 text-sm"
            >
              {/* No reason, ever: the field can hold medical information and
                  the projection never carries it. */}
              {COPY.barberCalendar.absence} · {absenceLabel(absence)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Cancelled and lapsed bookings, beside the day rather than inside it.
 *
 * A cancelled booking and the one that replaced it share a time — the ordinary
 * state of any shop that has ever had a cancellation. Drawn in one lane they
 * overlap, and the timeline then asserts the barber is in two places at once.
 *
 * A `<details>` rather than a client-side toggle: it opens with no JavaScript,
 * which is the whole reason this page ships none.
 */
function Recorded({ entries }: { entries: readonly CalendarEntry[] }) {
  return (
    <details className="rounded-lg border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        {COPY.barberCalendar.recordedHeading(entries.length)}
      </summary>
      <p className="text-muted-foreground mt-1 text-xs">{COPY.barberCalendar.recordedHelp}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.appointment.id}>
            <AppointmentRow entry={entry} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Whether the day being shown is behind the business's today.
 *
 * Compared on calendar fields rather than instants, and against the `today` the
 * read already resolved — asking the clock a second time could land on the
 * other side of midnight from the first.
 */
function isPast(date: LocalDate, today: LocalDate): boolean {
  return (
    date.year - today.year || date.month - today.month || date.day - today.day
  ) < 0;
}
