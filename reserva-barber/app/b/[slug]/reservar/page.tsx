import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { StepLink } from '@/components/booking/StepLink';
import { BookingStepIndicator } from '@/components/booking/BookingStepIndicator';
import { BookingSelectionSummary } from '@/components/booking/BookingSelectionSummary';
import { LocationStep } from '@/components/booking/LocationStep';
import { ServiceStep } from '@/components/booking/ServiceStep';
import { BarberStep } from '@/components/booking/BarberStep';
import { DateStep } from '@/components/booking/DateStep';
import { SlotStep } from '@/components/booking/SlotStep';
import { ClientDetailsStep } from '@/components/booking/ClientDetailsStep';
import {
  bookingStepHref,
  hasBranchChoice,
  resolveBookingSelection,
  withImpliedBranch,
  type BookingSelection,
  type BookingStep,
  type DiscardedSelection,
  type RawBookingSelection,
} from '@/server/application/booking/bookingSelectionParams';
import {
  resolveDateSelection,
  resolveSlotSelection,
} from '@/server/application/booking/bookingScheduleParams';
import {
  formatLocalDate,
  formatSlotTime,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import {
  BOOKING_ECHO_COOKIE,
  BOOKING_OUTCOME_PARAM,
  parseEcho,
  parseOutcomeCode,
  type BookingOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import type { BookingFieldErrors } from '@/server/application/booking/bookingRequestSchema';
import { cookies } from 'next/headers';
import type { Weekday } from '@/server/domain/models/weekday';
import type { BoundAvailability } from '@/server/application/services/PublicBookingCatalogService';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { bookingCatalogService } from './bookingCatalogService';
import type { BookingCatalogResolution } from '@/server/application/services/PublicBookingCatalogService';

/**
 * Rendered per request, like every other page in this project.
 *
 * Here it carries more weight than on the profile page: the catalogue is exactly
 * what an owner changes between one client's visit and the next, and a cached
 * answer would offer a barber who stopped working there this morning.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawBookingSelection>;
}

/**
 * Every parameterized variant declares the **bare** path as canonical
 * (design D14).
 *
 * Left alone, this route generates one crawlable URL per (branch, service,
 * barber) combination per shop — near-duplicates competing with `/b/{slug}`,
 * which B1 made deliberately indexable because discovery is what the product is
 * for. `noindex` was the alternative and loses the entry point; a canonical
 * keeps it and collapses the parameter space onto it.
 *
 * It has to be `generateMetadata` rather than a static `metadata` export: the
 * slug is dynamic, and a static object cannot name the URL it is canonicalizing
 * to.
 *
 * **No database read happens here.** Unlike the profile page's metadata, this
 * needs nothing but the slug, so it adds no query to the route T47 is about —
 * and it cannot throw a mistyped slug into a 500 on the way to its 404.
 *
 * The origin comes from `APP_ORIGIN` or the absolute values are **omitted**,
 * exactly as B1 decided: on a public route the `Host` header is supplied by a
 * stranger, and feeding it into a canonical tag would have a shop declare
 * someone else's origin authoritative for its own booking page.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const origin = resolveOrigin({ configured: process.env.APP_ORIGIN });

  if (origin === null) return {};

  return {
    metadataBase: new URL(origin),
    alternates: { canonical: `/b/${slug}/reservar` },
  };
}

const STALE_NOTICE: Record<DiscardedSelection, string> = {
  location: COPY.booking.staleLocation,
  service: COPY.booking.staleService,
  barber: COPY.booking.staleBarber,
  date: COPY.booking.staleDate,
  slot: COPY.booking.staleSlot,
};

/**
 * Deliberately **no `loading.tsx` and no Suspense boundary above this**
 * (design D8).
 *
 * B1 measured it on the deployment runtime: a boundary makes Next commit
 * `200 OK` before the page resolves, which degrades `notFound()` to a soft 404
 * and `permanentRedirect()` to a `<meta http-equiv="refresh">`. WhatsApp and
 * Instagram follow HTTP redirects when building a link preview and do not
 * execute a meta refresh — on a product whose distribution channel is WhatsApp.
 * This route makes both calls, so it inherits the constraint whole.
 */
async function resolve(slug: string): Promise<BookingCatalogResolution> {
  try {
    return await bookingCatalogService().resolveBySlug(slug);
  } catch (error) {
    logger.error('Failed to resolve booking catalog', toErrorLogContext('resolveBySlug', error));
    throw error;
  }
}

export default async function BookingPage({ params, searchParams }: PageProps) {
  const { slug } = await params;

  // The shop is resolved before a single query parameter is looked at. Until it
  // resolves there is no owner, so there is nothing any of those ids could be
  // checked against — and checking them later, against a catalogue, is the only
  // thing that makes one real.
  const resolution = await resolve(slug);

  if (resolution.type === 'notFound') {
    notFound();
  }

  if (resolution.type === 'redirect') {
    // The query string travels with the redirect (design D9). Dropping it would
    // discard the client's selection during a redirect they never asked for, and
    // the page would appear to lose their input. 308 rather than 302 because it
    // is method-preserving, and B4 posts to this path.
    const raw = await searchParams;
    permanentRedirect(
      bookingStepHref(resolution.canonicalSlug, {
        locationId: firstValue(raw.local),
        serviceId: firstValue(raw.servicio),
        barberId: firstValue(raw.barbero),
        date: firstValue(raw.fecha),
        time: firstValue(raw.hora),
      })
    );
  }

  const { catalog, availability } = resolution;
  const raw = await searchParams;
  const branchChoice = hasBranchChoice(catalog);
  const catalogSelection = withImpliedBranch(catalog, resolveBookingSelection(catalog, raw));

  // The schedule is resolved after the catalogue and only when the catalogue
  // selections are settled, because a date means nothing without a barber and a
  // time means nothing without a date. An earlier step therefore issues no
  // availability read at all.
  const schedule = await resolveSchedule(catalogSelection, raw, availability);

  const { selection } = catalogSelection;
  const step = schedule.step;
  const discarded = [...catalogSelection.discarded, ...schedule.discarded];
  const outcome = await resolveOutcome(raw[BOOKING_OUTCOME_PARAM]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{COPY.booking.heading}</h1>

      {catalog.length > 0 && <BookingStepIndicator current={step} hasBranchChoice={branchChoice} />}

      {/* A link that outlived the catalogue it was built from is the ordinary
          case here, not the exceptional one. The client is told what stopped
          working and never why — the system cannot tell deactivated from deleted
          either, and the owner did not agree to publish which it was. */}
      {discarded.map((what) => (
        <p
          key={what}
          role="status"
          className="border-border bg-muted/50 text-muted-foreground rounded-md border p-3 text-sm"
        >
          {STALE_NOTICE[what]}
        </p>
      ))}

      {/* What the write reported, if anything. Announced rather than focused:
          the client's cursor belongs where they left it. `datos` is absent
          from this map on purpose — a field-level rejection is rendered
          against its own input, not as a banner over the form. */}
      {outcome.code !== null && OUTCOME_NOTICE[outcome.code] !== undefined && (
        <p
          role="status"
          className="border-border bg-muted/50 text-muted-foreground rounded-md border p-3 text-sm"
        >
          {OUTCOME_NOTICE[outcome.code]}
        </p>
      )}

      <BookingSelectionSummary
        slug={slug}
        selection={selection}
        hasBranchChoice={branchChoice}
        date={schedule.date}
        slot={schedule.slot}
      />

      {step === 'location' && <LocationStep slug={slug} catalog={catalog} />}

      {step === 'service' && selection.location !== undefined && (
        <ServiceStep slug={slug} location={selection.location} hasBranchChoice={branchChoice} />
      )}

      {step === 'barber' && selection.location !== undefined && selection.service !== undefined && (
        <BarberStep slug={slug} location={selection.location} service={selection.service} />
      )}

      {step === 'date' &&
        selection.location !== undefined &&
        selection.service !== undefined &&
        selection.barber !== undefined &&
        schedule.today !== undefined &&
        schedule.workingWeekdays !== undefined && (
          <DateStep
            slug={slug}
            locationId={selection.location.location.id}
            serviceId={selection.service.service.id}
            barberId={selection.barber.id}
            today={schedule.today}
            workingWeekdays={schedule.workingWeekdays}
          />
        )}

      {step === 'slot' &&
        selection.location !== undefined &&
        selection.service !== undefined &&
        selection.barber !== undefined &&
        schedule.date !== undefined &&
        schedule.slots !== undefined && (
          <SlotStep
            slug={slug}
            locationId={selection.location.location.id}
            serviceId={selection.service.service.id}
            barberId={selection.barber.id}
            date={schedule.date}
            slots={schedule.slots}
            isToday={
              schedule.today !== undefined &&
              formatLocalDate(schedule.date) === formatLocalDate(schedule.today)
            }
          />
        )}

      {/* The last step, and the only one that writes. The inert control B1
          shipped and B2 and B3 inherited is retired: the route it would have
          pointed at now exists. Its disclosure moved to the confirmation page,
          where "your slot is held and payment is not available yet" is finally
          a true statement rather than a placeholder.

          A shop that cannot charge a deposit renders its own state here rather
          than a form — this is the wall B2 named when it left the
          payment-readiness gate to B4. It never says which half of the owner's
          configuration is missing. */}
      {step === 'datos' &&
        selection.location !== undefined &&
        selection.service !== undefined &&
        selection.barber !== undefined &&
        schedule.date !== undefined &&
        schedule.slot !== undefined &&
        // `undefined` is unreachable on this step — the resolver always sets it
        // — and is folded into the refusal anyway, because failing closed is
        // the only safe direction for a gate about charging money.
        (schedule.deposit === null || schedule.deposit === undefined ? (
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-muted-foreground text-sm">{COPY.booking.notTakingBookings}</p>
            <p className="text-muted-foreground text-sm">{COPY.booking.notTakingBookingsHelp}</p>
          </div>
        ) : (
          <ClientDetailsStep
            slug={slug}
            locationId={selection.location.location.id}
            serviceId={selection.service.service.id}
            barberId={selection.barber.id}
            date={schedule.date}
            time={formatSlotTime(schedule.slot)}
            depositAmount={schedule.deposit}
            fieldErrors={outcome.fieldErrors}
            submitted={outcome.submitted}
          />
        ))}

      {step !== 'location' && branchChoice && (
        <StepLink href={bookingStepHref(slug)} className="text-primary text-sm underline">
          {COPY.booking.back}
        </StepLink>
      )}
    </main>
  );
}

/** A repeated parameter keeps its first value across a redirect, matching the resolver. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

interface ResolvedOutcome {
  readonly code: BookingOutcomeCode | null;
  readonly fieldErrors?: BookingFieldErrors | undefined;
  readonly submitted?: { name?: string; email?: string; phone?: string } | undefined;
}

/**
 * What the write reported, read back from the URL and the echo cookie.
 *
 * The **codes** live in the query string, where a server render can read them
 * without JavaScript. The **values** the client typed live in an httpOnly
 * cookie instead, because a query string carrying a name, an email and a phone
 * number lands in browser history, in access logs and in the next request's
 * `Referer` — and this flow's rule is that contact details never reach a log.
 */
async function resolveOutcome(rawCode: string | string[] | undefined): Promise<ResolvedOutcome> {
  const code = parseOutcomeCode(rawCode);
  if (code === null) return { code: null };

  const echo = parseEcho((await cookies()).get(BOOKING_ECHO_COOKIE)?.value);
  if (echo === null) return { code };

  return { code, fieldErrors: echo.fieldErrors, submitted: echo.submitted };
}

/** The Spanish notice for every outcome that is not a field-level rejection. */
const OUTCOME_NOTICE: Partial<Record<BookingOutcomeCode, string>> = {
  horario: COPY.booking.staleSlot,
  'sin-pagos': COPY.booking.notTakingBookings,
  demasiados: COPY.booking.tooManyRequests,
  error: COPY.booking.bookingFailed,
};

interface ScheduleResolution {
  readonly step: BookingStep;
  readonly discarded: readonly DiscardedSelection[];
  readonly today?: LocalDate;
  readonly workingWeekdays?: ReadonlySet<Weekday>;
  readonly date?: LocalDate;
  readonly slots?: readonly Date[];
  readonly slot?: Date;
  /**
   * The deposit for this service, or `null` when the shop cannot take
   * bookings at all.
   *
   * Present only on the details step — the read that produces it is the one
   * B2's spec forbade everywhere else, and it stays confined to the single
   * step that enforces the gate.
   */
  readonly deposit?: string | null;
}

/**
 * The date and the time, resolved in that order and only when they can be.
 *
 * **Each read is paid for only by the step that needs it.** A client on the
 * branch, service or barber step issues no availability query; the date step
 * issues the cheap weekly one; the slot step issues the composed day read. That
 * ordering is the whole reason this lives here rather than above the switch —
 * it is the difference between one extra round trip and three.
 *
 * A discarded date or time behaves exactly as a discarded id does: the step it
 * belongs to renders, everything upstream survives, a Spanish notice says so,
 * and it is never a 404 and never a substitution.
 */
async function resolveSchedule(
  catalogSelection: { step: BookingStep; selection: BookingSelection },
  raw: RawBookingSelection,
  availability: BoundAvailability
): Promise<ScheduleResolution> {
  const { step, selection } = catalogSelection;
  const { barber, service } = selection;

  if (step !== 'date' || barber === undefined || service === undefined) {
    return { step, discarded: [] };
  }

  const today = availability.today();
  const requestedDate = resolveDateSelection(raw.fecha, today);
  const dateDiscarded: DiscardedSelection[] = requestedDate.discarded ? ['date'] : [];

  if (requestedDate.date === undefined) {
    return {
      step: 'date',
      discarded: dateDiscarded,
      today,
      workingWeekdays: await availability.workingWeekdays(barber.id),
    };
  }

  const slots = await availability.slotsFor({
    barberId: barber.id,
    date: requestedDate.date,
    durationMinutes: service.service.durationMinutes,
  });

  const requestedSlot = resolveSlotSelection(raw.hora, slots);
  const discarded: DiscardedSelection[] = [
    ...dateDiscarded,
    ...(requestedSlot.discarded ? (['slot'] as const) : []),
  ];

  if (requestedSlot.slot === undefined) {
    return { step: 'slot', discarded, today, date: requestedDate.date, slots };
  }

  // The details step, and the only place a payment row is read. Earlier steps
  // issue no payment query at all — the narrowing B2's spec anticipated.
  return {
    step: 'datos',
    discarded,
    today,
    date: requestedDate.date,
    slots,
    slot: requestedSlot.slot,
    deposit: await availability.depositFor(service.service.price),
  };
}
