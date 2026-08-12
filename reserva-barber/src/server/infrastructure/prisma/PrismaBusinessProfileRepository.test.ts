import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBusinessProfileRepository } from './PrismaBusinessProfileRepository';
import {
  DuplicateSlugError,
  ProfileAlreadyExistsError,
  DuplicatePlatformError,
} from '@/server/domain/errors/BusinessProfileErrors';
import type { BusinessProfileData } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';

const ROW = {
  id: 'profile-1',
  businessName: 'Barbería Don Juan',
  bio: null,
  photoUrl: null,
  coverUrl: null,
  publicSlug: 'barberia-don-juan',
  socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/a', orderIndex: 0 }],
};

function saveData(overrides: Partial<BusinessProfileData> = {}): BusinessProfileData {
  return {
    businessName: 'Barbería Don Juan',
    bio: null,
    publicSlug: 'barberia-don-juan',
    photoUrl: null,
    coverUrl: null,
    socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/a', orderIndex: 0 }],
    ...overrides,
  };
}

function createDb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const businessProfile = {
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(ROW),
    ...overrides,
  };
  const db = { businessProfile } as unknown as PrismaClient;
  return { db, businessProfile };
}

/**
 * The shape this stack actually produces for a unique violation — measured by
 * `scripts/p1-gate-db.ts`, not taken from Prisma's documentation. `meta.target`
 * does not exist here, and the column names arrive already quoted.
 */
function uniqueViolation(fields: string[]): unknown {
  return {
    code: 'P2002',
    meta: {
      modelName: 'BusinessProfile',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { fields: fields.map((field) => `"${field}"`) },
        },
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaBusinessProfileRepository - the read is one scoped query', () => {
  it('should_read_profile_and_links_in_a_single_owner_scoped_query', async () => {
    const { db, businessProfile } = createDb({ findFirst: vi.fn().mockResolvedValue(ROW) });

    const profile = await new PrismaBusinessProfileRepository(db).findByOwner(OWNER);

    expect(businessProfile.findFirst).toHaveBeenCalledTimes(1);
    const [args] = businessProfile.findFirst.mock.calls[0];
    expect(args.where).toEqual({ ownerId: OWNER });
    expect(profile?.businessName).toBe('Barbería Don Juan');
  });

  it('should_order_links_by_order_index_in_the_same_query', async () => {
    const { db, businessProfile } = createDb({ findFirst: vi.fn().mockResolvedValue(ROW) });

    await new PrismaBusinessProfileRepository(db).findByOwner(OWNER);

    const [args] = businessProfile.findFirst.mock.calls[0];
    expect(args.select.socialLinks.orderBy).toEqual({ orderIndex: 'asc' });
  });

  it('should_select_only_the_fields_the_entity_carries', async () => {
    const { db, businessProfile } = createDb({ findFirst: vi.fn().mockResolvedValue(ROW) });

    await new PrismaBusinessProfileRepository(db).findByOwner(OWNER);

    const [args] = businessProfile.findFirst.mock.calls[0];
    expect(args.select).toBeDefined();
    expect(args.select.ownerId).toBeUndefined();
    expect(args.select.createdAt).toBeUndefined();
  });

  it('should_report_a_missing_profile_as_null_rather_than_as_a_failure', async () => {
    const { db } = createDb();

    await expect(new PrismaBusinessProfileRepository(db).findByOwner(OWNER)).resolves.toBeNull();
  });

  it('should_resolve_a_foreign_owner_as_absent', async () => {
    // The predicate is what makes this true; the mock returning null stands in
    // for the database finding no row for that owner.
    const { db, businessProfile } = createDb();

    const profile = await new PrismaBusinessProfileRepository(db).findByOwner('someone-else');

    expect(profile).toBeNull();
    const [args] = businessProfile.findFirst.mock.calls[0];
    expect(args.where.ownerId).toBe('someone-else');
  });
});

describe('PrismaBusinessProfileRepository - the save is one atomic statement', () => {
  it('should_write_profile_and_links_in_a_single_upsert', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData());

    expect(businessProfile.upsert).toHaveBeenCalledTimes(1);
  });

  it('should_key_the_upsert_on_the_owner_so_first_and_later_saves_share_one_path', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData());

    const [args] = businessProfile.upsert.mock.calls[0];
    expect(args.where).toEqual({ ownerId: OWNER });
  });

  it('should_replace_the_link_set_on_update_rather_than_appending_to_it', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData());

    const [args] = businessProfile.upsert.mock.calls[0];
    // deleteMany before create is what makes a retry idempotent: an additive
    // write would double the set after a committed-but-timed-out save.
    expect(args.update.socialLinks.deleteMany).toEqual({});
    expect(args.update.socialLinks.create).toHaveLength(1);
  });

  it('should_not_delete_on_create_because_there_is_nothing_to_delete', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData());

    const [args] = businessProfile.upsert.mock.calls[0];
    expect(args.create.socialLinks.deleteMany).toBeUndefined();
    expect(args.create.socialLinks.create).toHaveLength(1);
  });

  it('should_clear_the_link_set_when_an_empty_set_is_submitted', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData({ socialLinks: [] }));

    const [args] = businessProfile.upsert.mock.calls[0];
    // "I have no social links" is a real save that must clear whatever is stored.
    expect(args.update.socialLinks.deleteMany).toEqual({});
    expect(args.update.socialLinks.create).toEqual([]);
  });

  it('should_carry_the_owner_id_only_on_the_create_branch', async () => {
    const { db, businessProfile } = createDb();

    await new PrismaBusinessProfileRepository(db).save(OWNER, saveData());

    const [args] = businessProfile.upsert.mock.calls[0];
    expect(args.create.ownerId).toBe(OWNER);
    // Re-assigning the owner on update would let a save move a profile between
    // owners, which nothing should ever be able to do.
    expect(args.update.ownerId).toBeUndefined();
  });
});

describe('PrismaBusinessProfileRepository - unique violations become domain errors', () => {
  it('should_translate_a_slug_collision', async () => {
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(uniqueViolation(['publicSlug'])) });

    await expect(
      new PrismaBusinessProfileRepository(db).save(OWNER, saveData())
    ).rejects.toBeInstanceOf(DuplicateSlugError);
  });

  it('should_carry_the_normalized_slug_on_the_error', async () => {
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(uniqueViolation(['publicSlug'])) });

    await expect(
      new PrismaBusinessProfileRepository(db).save(OWNER, saveData({ publicSlug: 'barberia-don-juan' }))
    ).rejects.toMatchObject({ slug: 'barberia-don-juan' });
  });

  it('should_translate_an_owner_collision_as_a_second_profile_not_as_a_slug_problem', async () => {
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(uniqueViolation(['ownerId'])) });

    // The owner double-clicked save. Telling them their slug is taken would be
    // a lie, and this is the assertion that keeps the two apart.
    await expect(
      new PrismaBusinessProfileRepository(db).save(OWNER, saveData())
    ).rejects.toBeInstanceOf(ProfileAlreadyExistsError);
  });

  it('should_translate_a_repeated_platform', async () => {
    const { db } = createDb({
      upsert: vi.fn().mockRejectedValue(uniqueViolation(['businessProfileId', 'platform'])),
    });

    await expect(
      new PrismaBusinessProfileRepository(db).save(OWNER, saveData())
    ).rejects.toBeInstanceOf(DuplicatePlatformError);
  });

  it('should_tolerate_the_quotes_the_driver_puts_around_column_names', async () => {
    // The driver reports ['"publicSlug"'], not ['publicSlug']. A naive equality
    // check matches nothing and every violation collapses into the fallback.
    const { db } = createDb({
      upsert: vi.fn().mockRejectedValue({
        code: 'P2002',
        meta: { driverAdapterError: { cause: { constraint: { fields: ['"publicSlug"'] } } } },
      }),
    });

    await expect(
      new PrismaBusinessProfileRepository(db).save(OWNER, saveData())
    ).rejects.toBeInstanceOf(DuplicateSlugError);
  });

  it('should_rethrow_a_unique_violation_on_an_unrecognized_constraint_untouched', async () => {
    const violation = uniqueViolation(['somethingElse']);
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(violation) });

    await expect(new PrismaBusinessProfileRepository(db).save(OWNER, saveData())).rejects.toBe(
      violation
    );
  });

  it('should_rethrow_a_unique_violation_whose_shape_it_cannot_read', async () => {
    // If a Prisma upgrade moves the constraint identity again, the failure must
    // surface as an infrastructure error rather than being mistranslated.
    const violation = { code: 'P2002', meta: {} };
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(violation) });

    await expect(new PrismaBusinessProfileRepository(db).save(OWNER, saveData())).rejects.toBe(
      violation
    );
  });

  it('should_rethrow_errors_that_are_not_unique_violations', async () => {
    const failure = new Error('connection lost');
    const { db } = createDb({ upsert: vi.fn().mockRejectedValue(failure) });

    await expect(new PrismaBusinessProfileRepository(db).save(OWNER, saveData())).rejects.toBe(
      failure
    );
  });
});
