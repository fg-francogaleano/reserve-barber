/**
 * The platforms a public profile can link to (docs/data-model.md §3).
 *
 * Declared here rather than imported from the generated Prisma client: the
 * domain layer must not depend on infrastructure, and the enum is a business
 * fact — which networks a barbershop can advertise — not a persistence detail.
 * The Prisma enum mirrors it, and the repository maps between them.
 */
export const SOCIAL_PLATFORMS = [
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'WHATSAPP',
  'X',
  'YOUTUBE',
  'WEBSITE',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * The upper bound on links per profile. Not a separate rule: it is what the
 * one-link-per-platform constraint already implies, derived rather than
 * restated so the two cannot drift apart.
 */
export const MAX_SOCIAL_LINKS = SOCIAL_PLATFORMS.length;

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * A single external link shown on the public profile.
 *
 * `url` is guaranteed by validation to carry an `http:` or `https:` protocol —
 * it is rendered as an `href` on a page anonymous clients open, so any other
 * scheme is stored cross-site scripting.
 */
export class SocialLink {
  constructor(
    public readonly platform: SocialPlatform,
    public readonly url: string,
    public readonly orderIndex: number
  ) {}
}

/**
 * The owner's public-facing brand (docs/data-model.md §2).
 *
 * Brand-level rather than per-location: the client picks a branch inside the
 * booking flow, so there is exactly one of these per owner.
 *
 * `publicSlug` is always in canonical form here. Anything that constructs a
 * profile from user input runs it through `slugify` first, so no consumer has to
 * wonder whether the value it holds is normalized.
 */
export class BusinessProfile {
  constructor(
    public readonly id: string,
    public readonly businessName: string,
    public readonly bio: string | null,
    public readonly photoUrl: string | null,
    public readonly coverUrl: string | null,
    public readonly publicSlug: string,
    public readonly socialLinks: readonly SocialLink[]
  ) {}
}

/**
 * Builds the link the owner shares.
 *
 * The origin is a parameter, never read from `window`: this is called during
 * server rendering, where `window` does not exist, and a client-side fallback
 * would produce a hydration mismatch on the one page whose output the owner is
 * about to copy (design D11).
 */
export function publicProfileUrl(origin: string, publicSlug: string): string {
  return `${origin.replace(/\/+$/, '')}/b/${publicSlug}`;
}
