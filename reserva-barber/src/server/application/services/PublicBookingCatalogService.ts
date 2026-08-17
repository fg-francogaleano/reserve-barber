import type { PublicBookingCatalog } from '@/server/domain/models/BookingCatalog';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IPublicCatalogRepository } from '@/server/domain/repositories/IPublicCatalogRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { SLUG_MAX_LENGTH } from '@/server/domain/models/slugify';
import { decidePublicSlugLookup } from '@/server/application/businessProfile/publicSlugLookup';

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
export type BookingCatalogResolution =
  | { type: 'render'; catalog: PublicBookingCatalog }
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
    private readonly logger: ILogger
  ) {}

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

    return { type: 'render', catalog: await this.catalog.findBookableCatalog(ownerId) };
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
