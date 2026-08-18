import { computeDepositAmount } from '@/server/domain/models/depositPolicy';
import { isBookable } from '@/server/domain/models/PaymentConfig';
import { generateCancellationToken } from '@/server/domain/models/cancellationToken';
import { holdExpiresAtFor } from '@/server/domain/models/Booking';
import {
  dayBoundsOf,
  formatSlotTime,
  parseLocalDate,
  weekdayOfLocalDate,
} from '@/server/domain/models/bookingCalendar';
import { hasTimezoneSupport } from '@/server/domain/models/businessTime';
import { findBarber, findLocation, findService } from '@/server/domain/models/BookingCatalog';
import type { IBookingRepository, HeldBooking } from '@/server/domain/repositories/IBookingRepository';
import type { IClientRepository } from '@/server/domain/repositories/IClientRepository';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { IPublicCatalogRepository } from '@/server/domain/repositories/IPublicCatalogRepository';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { PublicAvailabilityService } from './PublicAvailabilityService';
import type { BookingRequestInput } from '@/server/application/booking/bookingRequestSchema';

/**
 * Raised when the runtime cannot place an instant in the business's calendar.
 *
 * Asserted before any repository work. On the read side a missing timezone
 * database produces a page of plausible wrong times; here it would **persist**
 * an appointment three hours from where the client put it, and nothing
 * downstream would ever detect it.
 */
export class TimezoneUnavailableError extends Error {
  constructor() {
    super('Business timezone data is unavailable on this runtime');
    this.name = 'TimezoneUnavailableError';
  }
}

/**
 * Every way this write can end.
 *
 * Each is a distinct rendered state (spec: "Every outcome has a state"), and
 * none of the refusals is an exception: losing a race and meeting an unready
 * shop are ordinary outcomes of a public flow, and modelling them as throws
 * would put them in the same channel as a database outage.
 *
 * `selectionStale` and `slotTaken` are deliberately different: the first means
 * the link outlived the catalogue and the client restarts higher up the flow,
 * the second means someone else took this time and the client picks another.
 */
export type BookingCreationResult =
  | { readonly outcome: 'created'; readonly booking: HeldBooking }
  | { readonly outcome: 'alreadyHeld'; readonly booking: HeldBooking }
  | { readonly outcome: 'slotTaken' }
  | { readonly outcome: 'selectionStale' }
  | { readonly outcome: 'notPaymentReady' }
  | { readonly outcome: 'holdLimitReached' };

/**
 * The maximum number of live holds one client may have with one owner
 * (spec: "Holds are bounded per client and per origin").
 *
 * **This is the bound that actually holds.** The per-origin throttle at the
 * route is best-effort — this runtime has no counter shared across isolates —
 * whereas this one is checked against the database and cannot be spread across
 * addresses.
 *
 * Three is a judgement of the same kind as the lead time and the horizon: a
 * client legitimately holding four simultaneous appointments before paying for
 * any of them is not a case anyone has observed, and a script sweeping a
 * barber's calendar is stopped at three rather than at six thousand.
 */
export const MAX_LIVE_HOLDS_PER_CLIENT = 3;

/**
 * Creates the provisional booking that holds a slot.
 *
 * The order below is the specification's, and each step exists because the
 * step before it cannot answer the question:
 *
 * 1. **Resolve the shop from the slug.** Nothing submitted names an owner, and
 *    until one is resolved there is nothing any id could be checked against.
 * 2. **Re-verify the catalogue ids.** A hidden input is a rendering of state,
 *    not a claim about it. An id belonging to another owner is simply not in
 *    this catalogue, so it fails by the same path as one that never existed —
 *    there is no branch that could tell them apart, which is the point.
 * 3. **Gate on payment readiness.** B2 recorded that a client can complete
 *    every earlier step at a shop with no deposit configured and "meet the
 *    wall at B4". This is that wall.
 * 4. **Re-derive the time.** `hora` is matched against a freshly generated
 *    slot list and never parsed into an instant taken on trust.
 * 5. **Resolve the client**, then **hold the slot** transactionally.
 *
 * The owner id never leaves this class, exactly as it never leaves
 * `PublicBookingCatalogService` — it is resolved from the slug, used to scope
 * every read, and dropped.
 */
export class BookingCreationService {
  constructor(
    private readonly profiles: IBusinessProfileRepository,
    private readonly catalog: IPublicCatalogRepository,
    private readonly payments: IPaymentConfigRepository,
    private readonly availability: PublicAvailabilityService,
    private readonly clients: IClientRepository,
    private readonly bookings: IBookingRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  async create(input: BookingRequestInput): Promise<BookingCreationResult> {
    // Before any repository is touched. A runtime that cannot tell the
    // business's clock from UTC must not write an appointment at all.
    if (!hasTimezoneSupport()) {
      throw new TimezoneUnavailableError();
    }

    const now = new Date(this.clock.now());

    const ownerId = await this.profiles.findOwnerIdByPublicSlug(input.slug);
    if (ownerId === null) {
      return { outcome: 'selectionStale' };
    }

    // 2. Every id re-verified against a catalogue built under the owner's scope.
    const catalog = await this.catalog.findBookableCatalog(ownerId);
    const location = findLocation(catalog, input.locationId);
    const service = location === undefined ? undefined : findService(location, input.serviceId);
    const barber = service === undefined ? undefined : findBarber(service, input.barberId);

    if (location === undefined || service === undefined || barber === undefined) {
      return { outcome: 'selectionStale' };
    }

    // 3. The gate. One read answers both halves and cannot carry the token.
    const readiness = await this.payments.findPaymentReadinessForPublic(ownerId);
    if (readiness === null) {
      return { outcome: 'notPaymentReady' };
    }

    const gate = isBookable({
      hasMercadoPagoCredentials: readiness.hasMercadoPagoCredentials,
      transfer: readiness.transfer,
      depositValue: readiness.depositValue,
    });

    if (!gate.ready || readiness.depositValue === null) {
      return { outcome: 'notPaymentReady' };
    }

    // 4. The date and the time, both re-derived rather than trusted.
    const localDate = parseLocalDate(input.fecha);
    if (localDate === undefined) {
      return { outcome: 'selectionStale' };
    }

    const slots = await this.availability.slotsFor({
      barberId: barber.id,
      ownerId,
      date: localDate,
      durationMinutes: service.service.durationMinutes,
    });

    // Matched as a string against what is on offer, exactly as the read side
    // does it. A value naming a real hour nobody can book is refused by the
    // same path as a value naming no hour at all — a differential answer would
    // tell anyone sweeping which times a barber has taken.
    const startTime = slots.find((slot) => formatSlotTime(slot) === input.hora);
    if (startTime === undefined) {
      return { outcome: 'slotTaken' };
    }

    const endTime = new Date(startTime.getTime() + service.service.durationMinutes * 60_000);

    // 5. The client, then the hold.
    const client = await this.clients.resolve({
      ownerId,
      name: input.name,
      email: input.email,
      phone: input.phone,
    });

    const liveHolds = await this.bookings.countLiveHoldsForClient(client.id, now);
    if (liveHolds >= MAX_LIVE_HOLDS_PER_CLIENT) {
      this.logger.warn('Booking refused: client hold cap reached', {
        operation: 'BookingCreationService.create',
        ownerId,
        clientId: client.id,
        liveHolds,
      });
      return { outcome: 'holdLimitReached' };
    }

    const result = await this.bookings.createProvisional({
      ownerId,
      barberId: barber.id,
      serviceId: service.service.id,
      clientId: client.id,
      startTime,
      endTime,
      // Both snapshots derived here and never accepted from the submission.
      priceAtBooking: service.service.price,
      depositAmount: computeDepositAmount(
        { type: readiness.depositType, value: readiness.depositValue },
        service.service.price
      ),
      cancellationToken: generateCancellationToken(),
      holdExpiresAt: holdExpiresAtFor({ createdAt: now, startTime }),
      weekday: weekdayOfLocalDate(localDate),
      localDate,
      dayRange: dayBoundsOf(localDate),
      now,
    });

    if (result.outcome === 'slotTaken') {
      // The conflict rate is the only signal that will ever show whether the
      // concurrency design is holding in production.
      this.logger.warn('Booking refused: slot taken', {
        operation: 'BookingCreationService.create',
        ownerId,
        barberId: barber.id,
        serviceId: service.service.id,
      });
      return { outcome: 'slotTaken' };
    }

    // Identifiers only. This flow is the first to hold a stranger's name,
    // email and phone, and none of them appears in any log line.
    this.logger.info(
      result.outcome === 'created' ? 'Booking created' : 'Booking already held by this client',
      {
        operation: 'BookingCreationService.create',
        ownerId,
        bookingId: result.booking.id,
        barberId: barber.id,
        serviceId: service.service.id,
        clientId: client.id,
      }
    );

    return result;
  }
}
