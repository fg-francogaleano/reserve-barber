import type { BusinessProfile, SocialPlatform } from '@/server/domain/models/BusinessProfile';

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
 * Every method takes `ownerId`, so an unscoped profile query is inexpressible
 * through this contract — the same property the other repositories hold. Here
 * scoping is a predicate on a real `ownerId` column, as with `Service`.
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
