import {
  BusinessProfile,
  SocialLink,
  type PublicBusinessProfile,
  type SocialPlatform,
} from '@/server/domain/models/BusinessProfile';
import type {
  IBusinessProfileRepository,
  BusinessProfileData,
} from '@/server/domain/repositories/IBusinessProfileRepository';
import {
  DuplicateSlugError,
  ProfileAlreadyExistsError,
  DuplicatePlatformError,
} from '@/server/domain/errors/BusinessProfileErrors';
import type { PrismaClient } from '@/generated/prisma/client';

/** Only the fields the domain entity carries — never `SELECT *`. */
const PROFILE_FIELDS = {
  id: true,
  businessName: true,
  bio: true,
  photoUrl: true,
  coverUrl: true,
  publicSlug: true,
  socialLinks: {
    select: { platform: true, url: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' },
  },
} as const;

/**
 * What an anonymous visitor may see (B1 design D6).
 *
 * Deliberately NOT `PROFILE_FIELDS` minus a field or two. This list is written
 * from the other direction — it names what may be published, so a column added
 * to the model reaches nobody until someone adds it here on purpose. Note the
 * absent `id`: the entity's identifier has no business on a public page.
 */
const PUBLIC_PROFILE_FIELDS = {
  businessName: true,
  bio: true,
  photoUrl: true,
  coverUrl: true,
  publicSlug: true,
  socialLinks: {
    select: { platform: true, url: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' },
  },
} as const;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Which unique constraint a violation names, or `null` when that cannot be
 * determined.
 *
 * **Not `meta.target`.** That is the field Prisma's documentation and every
 * tutorial point at, and on this stack — Prisma 7 with the `@prisma/adapter-pg`
 * driver adapter — it does not exist. `scripts/p1-gate-db.ts` measured what is
 * actually populated:
 *
 *     meta.driverAdapterError.cause.constraint.fields = ['"publicSlug"']
 *
 * Column names arrive **already quoted**, so the quotes are stripped before
 * comparison. A naive equality check against `publicSlug` matches nothing, and
 * every violation would collapse into the fallback.
 *
 * Returning `null` rather than guessing is deliberate: if a future Prisma
 * version moves this again, the failure surfaces as an untranslated
 * infrastructure error instead of being mistranslated into a message about the
 * wrong field.
 */
function violatedConstraint(error: unknown): string[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } };
  };
  if (candidate.code !== UNIQUE_CONSTRAINT_VIOLATION) return null;

  const fields = candidate.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;

  return fields.map((field) => String(field).replaceAll('"', ''));
}

function sameFields(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((field) => actual.includes(field));
}

export class PrismaBusinessProfileRepository implements IBusinessProfileRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByOwner(ownerId: string): Promise<BusinessProfile | null> {
    const row = await this.db.businessProfile.findFirst({
      where: { ownerId },
      select: PROFILE_FIELDS,
    });

    return row === null ? null : toDomain(row);
  }

  /**
   * The one read here with no owner predicate (design D5).
   *
   * `findUnique` rather than `findFirst`: `publicSlug` is unique, and saying so
   * means the query planner uses the index and a second matching row is
   * impossible by construction rather than by luck of ordering.
   *
   * The result is mapped to a plain projection rather than through `toDomain` —
   * building a `BusinessProfile` here would mean inventing an `id` this query
   * deliberately did not read.
   */
  async findByPublicSlug(publicSlug: string): Promise<PublicBusinessProfile | null> {
    const row = await this.db.businessProfile.findUnique({
      where: { publicSlug },
      select: PUBLIC_PROFILE_FIELDS,
    });

    return row === null ? null : toPublicProjection(row);
  }

  /**
   * Creates or updates the profile and replaces its link set.
   *
   * One `upsert` carrying a nested write, rather than three statements in a
   * `$transaction` array. Two reasons, and neither is style:
   *
   * - The links need the profile's id, which does not exist until the profile is
   *   written. A batched array cannot express that dependency, and the
   *   interactive `$transaction(async tx => …)` form would hold a connection
   *   open across round trips against a transaction-mode pooler — which is the
   *   thing every other repository here is careful not to do.
   * - Prisma runs a nested write in an implicit transaction, so the profile and
   *   its links still commit together or not at all.
   *
   * `deleteMany` before `create` on the update branch is what makes a retry
   * idempotent: the stored set ends up equal to the submitted set no matter how
   * many times the save is applied. The create branch has nothing to delete.
   */
  async save(ownerId: string, data: BusinessProfileData): Promise<BusinessProfile> {
    const links = data.socialLinks.map((link) => ({
      platform: link.platform,
      url: link.url,
      orderIndex: link.orderIndex,
    }));

    const writable = {
      businessName: data.businessName,
      bio: data.bio,
      publicSlug: data.publicSlug,
      photoUrl: data.photoUrl,
      coverUrl: data.coverUrl,
    };

    try {
      const row = await this.db.businessProfile.upsert({
        where: { ownerId },
        // `ownerId` appears here and deliberately not on the update branch:
        // re-assigning it would let a save move a profile to another owner.
        create: { ownerId, ...writable, socialLinks: { create: links } },
        update: { ...writable, socialLinks: { deleteMany: {}, create: links } },
        select: PROFILE_FIELDS,
      });

      return toDomain(row);
    } catch (error) {
      throw this.translate(error, data);
    }
  }

  /**
   * Turns a unique violation into a domain error.
   *
   * This is the boundary. Reading the driver's error structure belongs on this
   * side of it — `docs/tech-debt.md` T15 records the project rejecting the same
   * knowledge in the application layer twice, and the structure here is nested
   * four levels deep inside a driver payload. What leaves this class is a domain
   * type (design D8).
   */
  private translate(error: unknown, data: BusinessProfileData): unknown {
    const fields = violatedConstraint(error);
    if (fields === null) return error;

    if (sameFields(fields, ['publicSlug'])) return new DuplicateSlugError(data.publicSlug);
    if (sameFields(fields, ['ownerId'])) return new ProfileAlreadyExistsError();
    if (sameFields(fields, ['businessProfileId', 'platform'])) {
      return new DuplicatePlatformError(findRepeatedPlatform(data) ?? 'unknown');
    }

    return error;
  }
}

function findRepeatedPlatform(data: BusinessProfileData): string | null {
  const seen = new Set<string>();
  for (const link of data.socialLinks) {
    if (seen.has(link.platform)) return link.platform;
    seen.add(link.platform);
  }
  return null;
}

interface ProfileRow {
  id: string;
  businessName: string;
  bio: string | null;
  photoUrl: string | null;
  coverUrl: string | null;
  publicSlug: string;
  socialLinks: { platform: string; url: string; orderIndex: number }[];
}

type PublicProfileRow = Omit<ProfileRow, 'id'>;

function toPublicProjection(row: PublicProfileRow): PublicBusinessProfile {
  return {
    businessName: row.businessName,
    bio: row.bio,
    photoUrl: row.photoUrl,
    coverUrl: row.coverUrl,
    publicSlug: row.publicSlug,
    socialLinks: row.socialLinks.map(
      (link) => new SocialLink(link.platform as SocialPlatform, link.url, link.orderIndex)
    ),
  };
}

function toDomain(row: ProfileRow): BusinessProfile {
  return new BusinessProfile(
    row.id,
    row.businessName,
    row.bio,
    row.photoUrl,
    row.coverUrl,
    row.publicSlug,
    row.socialLinks.map(
      (link) => new SocialLink(link.platform as SocialPlatform, link.url, link.orderIndex)
    )
  );
}
