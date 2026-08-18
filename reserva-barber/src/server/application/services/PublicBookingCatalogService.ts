import type { PublicBookingCatalog } from '@/server/domain/models/BookingCatalog';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IPublicCatalogRepository } from '@/server/domain/repositories/IPublicCatalogRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { SLUG_MAX_LENGTH } from '@/server/domain/models/slugify';
import { decidePublicSlugLookup } from '@/server/application/businessProfile/publicSlugLookup';
import type { PublicAvailabilityService } from './PublicAvailabilityService';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';
import type { Weekday } from '@/server/domain/models/weekday';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import { isBookable } from '@/server/domain/models/PaymentConfig';
import { computeDepositAmount } from '@/server/domain/models/depositPolicy';

/**
 * What the booking route should do with the slug it was given.
 *
 * The same three-way shape `PublicProfileResolution` uses, deliberately: the two
 * routes answer the same question about the same value, and a second vocabulary
 * for it would let them drift into different answers.
 *
 * `redirect` carries the canonical slug rather than a URL — composing the path,
 * and preserving the query string across it, is the route's job.
 */
/**
 * The availability reads for the shop that was just resolved, already bound to
 * its owner.
 *
 * **This is how B3 asks an owner-scoped question without being told the owner**
 * (B2 design D3, which this preserves rather than relaxes). The alternative was
 * adding an `ownerId` field to the resolution below — the one thing that
 * requirement says it must not have — or resolving the slug a second time, which
 * would spend an extra Supavisor round trip on the route T47 is about, to
 * recover a value the service already had.
 *
 * A bound function is neither: the owner is captured where it was resolved and
 * is unreachable from the caller. It is also unserializable by construction, so
 * it cannot be handed to a Client Component even by accident.
 */
export interface BoundAvailability {
  /** The business's current calendar day. */
  today(): LocalDate;
  /** Which weekdays this barber works at all — the date strip's only input. */
  workingWeekdays(barberId: string): Promise<Set<Weekday>>;
  /** The start times on offer for one barber, service duration and day. */
  slotsFor(input: { barberId: string; date: LocalDate; durationMinutes: number }): Promise<Date[]>;
  /**
   * Whether a deposit can be charged, and what it would be for a given price
   * (B4 design D5).
   *
   * Bound like the availability reads and for the same reason: the owner is
   * captured where it was resolved and never reaches the page.
   *
   * Returns `null` when the shop cannot take bookings at all — no payment
   * method, no deposit policy, or no configuration row. The caller renders the
   * not-taking-bookings state and never learns which half is missing, because
   * that is not a distinction the client can act on.
   */
  depositFor(price: string): Promise<string | null>;
}

export type BookingCatalogResolution =
  | { type: 'render'; catalog: PublicBookingCatalog; availability: BoundAvailability }
  | { type: 'redirect'; canonicalSlug: string }
  | { type: 'notFound' };

/** Control characters and anything that could break out of a log line. */
const UNLOGGABLE_CHARACTERS = /[\p{C}]/gu;

function forLog(raw: string): string {
  return raw.replace(UNLOGGABLE_CHARACTERS, '').slice(0, SLUG_MAX_LENGTH);
}

/**
 * Resolves what a shop can be booked for, for a visitor with no session.
 *
 * **The owner never leaves this class** (design D3). It is resolved from the
 * slug, used to scope the catalogue read, and dropped; `BookingCatalogResolution`
 * has no field that could carry it. That is the whole reason this service exists
 * rather than the route calling two repositories itself — a route holding an
 * owner id is one prop away from shipping it to the browser.
 *
 * `PaymentConfig` is absent here and must stay absent. B2 answers *is there
 * anything to book*; whether a deposit can be charged is B4's question, and the
 * row that answers it holds the encrypted Mercado Pago access token.
 */
export class PublicBookingCatalogService {
  constructor(
    private readonly profiles: IBusinessProfileRepository,
    private readonly catalog: IPublicCatalogRepository,
    private readonly logger: ILogger,
    private readonly availability: PublicAvailabilityService,
    /**
     * Optional, and the optionality is the point (B4 design D5).
     *
     * The public **profile** page builds this service for its bookability gate
     * and has no deposit to compute, so it passes nothing and cannot reach a
     * payment row at all. Only the booking route wires it.
     */
    private readonly payments?: IPaymentConfigRepository
  ) {}

  /** Binds the availability and deposit reads to an owner that never leaves this class. */
  private bindAvailability(ownerId: string): BoundAvailability {
    return {
      today: () => this.availability.today(),
      workingWeekdays: (barberId) => this.availability.workingWeekdays(barberId, ownerId),
      slotsFor: (input) => this.availability.slotsFor({ ...input, ownerId }),
      depositFor: (price) => this.depositFor(ownerId, price),
    };
  }

  /**
   * The deposit for a price, or `null` when this shop cannot take bookings.
   *
   * **This is the read B2's spec forbade and B4 narrowed** (design D5). The
   * prohibition was absolute because no earlier surface needed the row, and the
   * cheapest guarantee was to hand the flow no repository at all. The reason it
   * gave was the encrypted access token — so the guarantee changes shape rather
   * than weakening: `findPaymentReadinessForPublic` returns a type with no
   * field the token fits into, and its query never selects that column.
   *
   * Called only from the details step. A client on any earlier step issues no
   * payment-configuration query at all.
   */
  private async depositFor(ownerId: string, price: string): Promise<string | null> {
    if (this.payments === undefined) return null;

    const readiness = await this.payments.findPaymentReadinessForPublic(ownerId);
    if (readiness === null || readiness.depositValue === null) return null;

    const gate = isBookable({
      hasMercadoPagoCredentials: readiness.hasMercadoPagoCredentials,
      transfer: readiness.transfer,
      depositValue: readiness.depositValue,
    });

    if (!gate.ready) return null;

    return computeDepositAmount(
      { type: readiness.depositType, value: readiness.depositValue },
      price
    );
  }

  async resolveBySlug(requestedSlug: string): Promise<BookingCatalogResolution> {
    const lookup = decidePublicSlugLookup(requestedSlug);

    if (lookup.type === 'reject') {
      this.logger.debug('Booking catalog slug rejected before lookup', {
        operation: 'PublicBookingCatalogService.resolveBySlug',
        requestedSlug: forLog(requestedSlug),
      });
      return { type: 'notFound' };
    }

    const ownerId = await this.profiles.findOwnerIdByPublicSlug(lookup.slug);

    if (ownerId === null) {
      this.logger.info('Booking catalog slug did not resolve', {
        operation: 'PublicBookingCatalogService.resolveBySlug',
        requestedSlug: forLog(requestedSlug),
        normalizedSlug: lookup.slug,
      });
      return { type: 'notFound' };
    }

    // Before the catalogue read, not after. A non-canonical spelling is going to
    // be redirected regardless, so reading the catalogue first would spend a
    // query on a response that discards it — on the route T47 is about.
    if (!lookup.isCanonical) {
      return { type: 'redirect', canonicalSlug: lookup.slug };
    }

    return {
      type: 'render',
      catalog: await this.catalog.findBookableCatalog(ownerId),
      availability: this.bindAvailability(ownerId),
    };
  }

  /**
   * Whether this shop can be booked at all — the gate the profile page reads
   * (design D10).
   *
   * Deliberately the same catalogue read rather than a cheaper `count`. The
   * profile page and the booking route must agree about what "bookable" means,
   * and two queries that answer that question separately are two definitions
   * waiting to disagree. React's `cache()` deduplicates the call within a render
   * pass, so asking here costs nothing the page was not already paying.
   */
  async isBookable(ownerId: string): Promise<boolean> {
    const catalog = await this.catalog.findBookableCatalog(ownerId);
    return catalog.length > 0;
  }

  /**
   * The owner behind a slug, for callers that already resolved the profile and
   * only need the gate.
   *
   * Returns `null` rather than throwing on an unknown slug: the profile page has
   * its own not-found path and reaching this method at all means the slug
   * resolved a moment ago.
   */
  async findOwnerId(canonicalSlug: string): Promise<string | null> {
    return this.profiles.findOwnerIdByPublicSlug(canonicalSlug);
  }
}
