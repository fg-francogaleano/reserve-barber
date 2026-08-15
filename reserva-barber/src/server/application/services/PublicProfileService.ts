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

  async resolveBySlug(requestedSlug: string): Promise<PublicProfileResolution> {
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

    const profile = await this.profiles.findByPublicSlug(lookup.slug);

    if (profile === null) {
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

    return { type: 'render', profile };
  }
}
