import type { PublicBusinessProfile } from '@/server/domain/models/BusinessProfile';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { SLUG_MAX_LENGTH } from '@/server/domain/models/slugify';
import { decidePublicSlugLookup } from '@/server/application/businessProfile/publicSlugLookup';

/**
 * What the public route should do with the slug it was given.
 *
 * `redirect` carries the canonical slug, not a URL: composing the path is the
 * route's job, and a service that returns URLs starts deciding routing.
 */
export type PublicProfileResolution =
  | { type: 'render'; profile: PublicBusinessProfile }
  | { type: 'redirect'; canonicalSlug: string }
  | { type: 'notFound' };

/**
 * The same resolution, plus the owner behind it — for the caller that also has
 * to decide whether the shop can be booked (B2 design D10).
 *
 * A **separate type**, so that `PublicProfileResolution` stays exactly what it
 * was and nothing that only renders a profile can accidentally receive an owner
 * id. `ownerId` is a query predicate here and nothing else: it must not reach a
 * component prop, the serialized payload, or a URL.
 */
export type PublicProfileWithOwner =
  | { type: 'render'; profile: PublicBusinessProfile; ownerId: string }
  | { type: 'redirect'; canonicalSlug: string }
  | { type: 'notFound' };

/**
 * Control characters and anything that could break out of a log line. The
 * requested slug is stranger-supplied and ends up in structured logs.
 */
const UNLOGGABLE_CHARACTERS = /[\p{C}]/gu;

function forLog(raw: string): string {
  return raw.replace(UNLOGGABLE_CHARACTERS, '').slice(0, SLUG_MAX_LENGTH);
}

/**
 * Resolves the public profile behind a slug, for a visitor with no session.
 *
 * The only application service in this project that takes no `ownerId` — see
 * the exception documented on `IBusinessProfileRepository` (B1 design D5).
 */
export class PublicProfileService {
  constructor(
    private readonly profiles: IBusinessProfileRepository,
    private readonly logger: ILogger
  ) {}

  /**
   * What the page renders — the projection, and nothing else.
   *
   * A thin projection of `resolveWithOwner`, so there is one implementation of
   * the slug decision rather than two that can drift. The owner is dropped here
   * rather than never fetched: it is one more column on a row already being read
   * by its unique key, and the alternative was a second round trip against the
   * same row (B2 design D10).
   */
  async resolveBySlug(requestedSlug: string): Promise<PublicProfileResolution> {
    const resolution = await this.resolveWithOwner(requestedSlug);

    if (resolution.type !== 'render') return resolution;

    // Rebuilt field by field rather than spread-minus-`ownerId`: a spread would
    // carry any field added to `PublicProfileWithOwner` later, which is the
    // shape of mistake B1's projection rule exists to make impossible. A caller
    // that only renders must not receive an owner id it could hand to a
    // component by accident.
    return { type: 'render', profile: resolution.profile };
  }

  /**
   * The same resolution, keeping the owner for the caller that has to decide
   * whether the shop can be booked at all (design D10).
   *
   * The value returned here is a **query predicate**. It must not reach a
   * component prop, the serialized payload or a URL, and the profile page is
   * expected to pass it straight to the bookability gate and nowhere else.
   */
  async resolveWithOwner(requestedSlug: string): Promise<PublicProfileWithOwner> {
    const lookup = decidePublicSlugLookup(requestedSlug);

    if (lookup.type === 'reject') {
      // No query: the value cannot be a stored slug. Logged at `debug` rather
      // than `info` — this is malformed input, not the "a client is holding a
      // link that stopped working" signal T33 needs, and mixing the two would
      // bury the signal in the noise.
      this.logger.debug('Public profile slug rejected before lookup', {
        operation: 'PublicProfileService.resolveBySlug',
        requestedSlug: forLog(requestedSlug),
      });
      return { type: 'notFound' };
    }

    const found = await this.profiles.findWithOwnerByPublicSlug(lookup.slug);

    if (found === null) {
      // The T33 signal. This log is the only inventory that will exist of links
      // that stopped resolving after an owner changed their slug — and the only
      // way to tell that apart from someone enumerating slugs, which is why the
      // value is recorded and not just the fact (design D15).
      this.logger.info('Public profile slug did not resolve', {
        operation: 'PublicProfileService.resolveBySlug',
        requestedSlug: forLog(requestedSlug),
        normalizedSlug: lookup.slug,
      });
      return { type: 'notFound' };
    }

    if (!lookup.isCanonical) {
      return { type: 'redirect', canonicalSlug: lookup.slug };
    }

    return { type: 'render', profile: found.profile, ownerId: found.ownerId };
  }
}
