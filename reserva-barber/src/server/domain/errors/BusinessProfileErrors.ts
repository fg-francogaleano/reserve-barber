/**
 * Domain errors for the public profile.
 *
 * The first three correspond one-to-one with the three unique constraints this
 * change can violate. They exist as distinct types, rather than one error with a
 * field, because the whole point is that the three cannot be confused: an owner
 * who double-clicked save collided on `ownerId`, and telling them their slug is
 * taken would be a lie (design D8).
 *
 * The repository raises them. Nothing Prisma-shaped crosses that boundary.
 */

export class DuplicateSlugError extends Error {
  constructor(
    /**
     * The **normalized** slug that collided, not what the owner typed.
     * Submitting "Barbería Don Juan" against a stored "barberia-don-juan" must
     * produce a message naming the canonical form, or the error appears to
     * refer to a different string entirely.
     */
    public readonly slug: string
  ) {
    super('Public slug already taken');
    this.name = 'DuplicateSlugError';
  }
}

/**
 * A second profile for an owner who already has one.
 *
 * Only reachable through a race: two first-ever saves submitted concurrently
 * both observe no profile, and the unique constraint on `ownerId` refuses the
 * loser. The remedy is a retry, which will find the row and update it.
 */
export class ProfileAlreadyExistsError extends Error {
  constructor() {
    super('This owner already has a business profile');
    this.name = 'ProfileAlreadyExistsError';
  }
}

/**
 * Two links naming the same platform.
 *
 * Validation rejects this before any upload or transaction, so reaching the
 * database constraint means a defect rather than bad input. It is still
 * translated: a constraint that can fire needs a defined outcome, and an
 * untranslated one would surface as a generic infrastructure failure that hides
 * the bug instead of reporting it.
 */
export class DuplicatePlatformError extends Error {
  constructor(public readonly platform: string) {
    super('Duplicate social platform for this profile');
    this.name = 'DuplicatePlatformError';
  }
}

/**
 * Which image the failure belongs to.
 *
 * Carried on every image error because the form has two file inputs: an error
 * that does not say which one leaves the owner guessing, and "one of your two
 * images is wrong" is barely better than no message.
 */
export type ImageSlot = 'photo' | 'cover';

export class UnsupportedImageTypeError extends Error {
  constructor(public readonly slot: ImageSlot) {
    super('Image must be JPEG, PNG or WEBP');
    this.name = 'UnsupportedImageTypeError';
  }
}

export class ImageTooLargeError extends Error {
  constructor(public readonly slot: ImageSlot) {
    super('Image exceeds the maximum accepted size');
    this.name = 'ImageTooLargeError';
  }
}

/**
 * The storage provider refused or failed the write.
 *
 * Carries the object key so the failure can be logged with something actionable.
 * It carries no submitted business data — the same rule the database diagnostics
 * follow, for the same reason: provider messages embed values, which puts
 * business data in the log stream and lets crafted input forge log fields.
 */
export class ImageUploadFailedError extends Error {
  constructor(
    public readonly key: string,
    public readonly cause: string
  ) {
    super('Image upload failed');
    this.name = 'ImageUploadFailedError';
  }
}
