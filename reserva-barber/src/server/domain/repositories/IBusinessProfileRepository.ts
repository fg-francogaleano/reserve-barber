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
 * **Every method takes `ownerId` except two.** For the owner-facing methods,
 * scoping is a predicate on a real `ownerId` column, as with `Service`, and an
 * unscoped query is inexpressible through them — the same property the other
 * repositories hold.
 *
 * There are exactly **two** deliberate exceptions, and each is bounded by what
 * it may return. They exist because the public surface is served to a visitor
 * with no session, so there is no owner to scope by: **the slug is the key.**
 * The exceptions are named here rather than routed around with a second
 * contract, which would duplicate the mapping and leave two repositories over
 * one table to keep in step. This project documents its exceptions —
 * `PaymentConfig` does it for its three writers, `decideGuardAction` does it for
 * Server Actions.
 *
 * 1. `findWithOwnerByPublicSlug` (B1 design D5, widened by B2 design D10) — what
 *    the public profile page renders, plus the owner it needs to answer whether
 *    the shop can be booked. Bounded by its return type: a
 *    `PublicBusinessProfile` projection, never the aggregate, and the owner in a
 *    **separate field** so the projection itself still carries no `ownerId`.
 * 2. `findOwnerIdByPublicSlug` (B2 design D3) — the owner behind a slug, so that
 *    the booking flow's catalogue reads can be **owner-scoped like every other
 *    read in the project**. Bounded to a single column. Distinct from the above
 *    because the booking route needs the owner and never the profile; reusing
 *    the wider read there would select five columns to discard four.
 *
 * Two is not the beginning of a trend. The alternative for B2 was giving the
 * location, service, barber and assignment repositories slug-scoped methods of
 * their own, which would have taken the count from one to five and put an
 * unscoped query inside four aggregates that currently make one impossible.
 * Resolving the owner once, here, keeps that property everywhere else.
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
   * The id of the owner whose profile holds this slug, or `null` when no
   * profile does.
   *
   * One of the two methods here that carry no owner — this one *resolves* one.
   * The booking flow needs the owner to scope its catalogue reads and never
   * needs the profile itself, so it reads a single column rather than a
   * projection it would discard.
   *
   * The value it returns is for use as a query predicate only. It MUST NOT enter
   * a projection, a component prop, a serialized payload or a URL.
   *
   * The slug is expected already canonical; callers normalize before asking.
   */
  findOwnerIdByPublicSlug(publicSlug: string): Promise<string | null>;

  /**
   * The profile behind a public slug — the projection an anonymous visitor may
   * see, with its links ordered by `orderIndex` — **and** the owner behind it.
   *
   * `null` means no profile holds that slug, which is an ordinary outcome: a
   * client following a link the owner has since changed (`docs/tech-debt.md`
   * T33) reaches exactly this, and it is a 404, not an error.
   *
   * The public page renders the projection and separately has to know whether
   * the shop can be booked at all, which needs the owner. B1 returned the
   * projection alone; B2 widened this read rather than adding a second one,
   * because two reads of the same row by the same unique key is two round trips
   * on the busiest public page in the product (design D10).
   *
   * **The values come back in separate fields and are never merged.** `profile`
   * is the same narrow projection B1 defined and still carries no `ownerId`, so
   * a column added to the model still reaches no anonymous visitor by default.
   * The owner sits beside it under the rule above — a query predicate, never a
   * value that reaches a component, a payload or a URL.
   *
   * The slug is expected already canonical; callers normalize before asking.
   */
  findWithOwnerByPublicSlug(
    publicSlug: string
  ): Promise<{ profile: PublicBusinessProfile; ownerId: string } | null>;

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
