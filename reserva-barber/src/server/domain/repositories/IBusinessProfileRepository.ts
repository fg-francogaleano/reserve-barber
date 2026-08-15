import type {
  BusinessProfile,
  PublicBusinessProfile,
  SocialPlatform,
} from '@/server/domain/models/BusinessProfile';

export interface SocialLinkData {
  platform: SocialPlatform;
  url: string;
  orderIndex: number;
}

export interface BusinessProfileData {
  businessName: string;
  bio: string | null;
  /** Already canonical — `slugify` has run. */
  publicSlug: string;
  /** Resolved storage URLs, or `null` for "no image". */
  photoUrl: string | null;
  coverUrl: string | null;
  /** The complete set. What is stored after the write equals this exactly. */
  socialLinks: readonly SocialLinkData[];
}

/**
 * Repository contract for the BusinessProfile aggregate.
 *
 * **Every method takes `ownerId` except one.** For the owner-facing methods,
 * scoping is a predicate on a real `ownerId` column, as with `Service`, and an
 * unscoped query is inexpressible through them — the same property the other
 * repositories hold.
 *
 * `findByPublicSlug` is the deliberate exception, and the only one (B1 design
 * D5). The public profile page is served to a visitor with no session, so there
 * is no owner to scope by: **the slug is the key.** The exception is named here
 * rather than routed around with a second contract, which would duplicate the
 * mapping and leave two repositories over one table to keep in step. This
 * project documents its exceptions — `PaymentConfig` does it for its three
 * writers, `decideGuardAction` does it for Server Actions.
 *
 * The exception is bounded by its return type: it yields a
 * `PublicBusinessProfile` projection, never the aggregate.
 *
 * **This contract throws domain errors, never driver errors.** `save` raises
 * `DuplicateSlugError`, `ProfileAlreadyExistsError` or `DuplicatePlatformError`
 * when the corresponding unique constraint is violated. Identifying *which*
 * constraint fired requires reading the driver's error structure, and that
 * reading belongs on the infrastructure side of this boundary: `docs/tech-debt.md`
 * T15 records the project rejecting the same knowledge in the application layer
 * twice, for the reason that still holds (design D8).
 */
export interface IBusinessProfileRepository {
  /**
   * The owner's profile with its links ordered by `orderIndex`, in one query.
   *
   * `null` means the owner has not saved a profile yet, which is an ordinary
   * first-run state and not an error.
   */
  findByOwner(ownerId: string): Promise<BusinessProfile | null>;

  /**
   * The profile behind a public slug, as the projection an anonymous visitor
   * may see, with its links ordered by `orderIndex`.
   *
   * The one method here that carries no owner — see the exception documented on
   * this interface. `null` means no profile holds that slug, which is an
   * ordinary outcome: a client following a link the owner has since changed
   * (`docs/tech-debt.md` T33) reaches exactly this, and it is a 404, not an
   * error.
   *
   * The slug is expected already canonical; callers normalize before asking.
   */
  findByPublicSlug(publicSlug: string): Promise<PublicBusinessProfile | null>;

  /**
   * Creates or updates the profile and **replaces** its entire link set, inside
   * one transaction.
   *
   * Replacement rather than diffing: the owner edits the set as a whole, so an
   * additive write would duplicate the links on a retry after a commit whose
   * acknowledgement was lost. Replacing makes the retry idempotent by
   * construction, the same shape the weekly schedule uses.
   */
  save(ownerId: string, data: BusinessProfileData): Promise<BusinessProfile>;
}
