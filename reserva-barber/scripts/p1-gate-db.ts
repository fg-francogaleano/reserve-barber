// GATE P1 (database half) — the three unique constraints this change can
// violate are distinguishable from each other at the application layer.
//
// Separate from `p1-gate.ts` because the two halves need different credentials:
// this one runs on `DATABASE_URL` alone, while the storage half needs a real
// owner sign-in. Splitting them means the database probes stay runnable in CI
// and by anyone, rather than being gated behind a password.
//
// Why this is a gate and not a unit test: `BusinessProfileService` will map
// `P2002` to three different outcomes by reading `error.meta.target`. A mocked
// Prisma client can only prove we read the field we think we read — it cannot
// prove PostgreSQL and Prisma actually report the constraint name we branch on.
// If `meta.target` came back empty or shaped differently, every mapping would
// silently collapse into the fallback and an owner who double-clicked save
// would be told their slug is taken (design D8).
//
//   npx tsx scripts/p1-gate-db.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let failures = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

/**
 * Which constraint a unique violation names.
 *
 * NOT `meta.target`. That is the field every Prisma tutorial reaches for, and on
 * this stack — Prisma 7 with the `@prisma/adapter-pg` driver adapter — it does
 * not exist. The first version of this gate asserted against it and failed all
 * four probes, which is the entire reason the gate ran before the code that
 * would have depended on it.
 *
 * What is actually there:
 *
 *   meta.driverAdapterError.cause.constraint.fields = ['"publicSlug"']
 *
 * Note the embedded quotes: the driver reports the column name already quoted,
 * so a naive equality check against 'publicSlug' fails. They are stripped here.
 */
function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } };
  };
  if (candidate.code !== 'P2002') return null;

  const fields = candidate.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return '(P2002 with no usable constraint fields)';
  }

  return fields.map((field) => String(field).replaceAll('"', '')).join(',');
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
    max: 5,
    maxUses: 1,
  });
  const prisma = new PrismaClient({ adapter });

  const owner = await prisma.owner.findFirst({ select: { id: true } });
  if (!owner) {
    throw new Error('Gate needs the Owner row to exist — run `npm run provision-owner` first');
  }

  const suffix = Date.now();
  const slug = `gate-profile-${suffix}`;
  let profileId: string | null = null;

  try {
    const created = await prisma.businessProfile.create({
      data: { ownerId: owner.id, businessName: 'Gate Fixture', publicSlug: slug },
      select: { id: true },
    });
    profileId = created.id;

    // ---------------------------------------------------------------- probe A
    // A second profile for the same owner. The application must read this as
    // "you already have a profile, retry" and never as a slug problem.

    let ownerViolation: string | null = null;
    try {
      await prisma.businessProfile.create({
        data: { ownerId: owner.id, businessName: 'Second', publicSlug: `${slug}-other` },
      });
    } catch (error) {
      ownerViolation = violatedConstraint(error);
    }

    report(
      'A a second profile for one owner violates the ownerId constraint',
      ownerViolation !== null && ownerViolation.includes('ownerId'),
      ownerViolation ?? 'NO VIOLATION — a second profile was accepted'
    );

    // ---------------------------------------------------------------- probe B
    // A taken slug. Must be distinguishable from probe A, or the two collapse
    // into one message and one of them is a lie.

    let slugViolation: string | null = null;
    try {
      await prisma.businessProfile.create({
        data: { ownerId: 'no-such-owner', businessName: 'Third', publicSlug: slug },
      });
    } catch (error) {
      slugViolation = violatedConstraint(error);
    }

    report(
      'B a taken slug violates the publicSlug constraint',
      slugViolation !== null && slugViolation.includes('publicSlug'),
      slugViolation ?? 'NO VIOLATION — a duplicate slug was accepted'
    );

    report(
      'C the two constraints are distinguishable from each other',
      ownerViolation !== null && slugViolation !== null && ownerViolation !== slugViolation,
      `${ownerViolation ?? 'null'} vs ${slugViolation ?? 'null'}`
    );

    // ---------------------------------------------------------------- probe D
    // The third constraint, reached from inside a link write.

    await prisma.socialLink.create({
      data: { businessProfileId: profileId, platform: 'INSTAGRAM', url: 'https://example.com', orderIndex: 0 },
    });

    let platformViolation: string | null = null;
    try {
      await prisma.socialLink.create({
        data: { businessProfileId: profileId, platform: 'INSTAGRAM', url: 'https://example.org', orderIndex: 1 },
      });
    } catch (error) {
      platformViolation = violatedConstraint(error);
    }

    report(
      'D a repeated platform violates the (profile, platform) constraint',
      platformViolation !== null &&
        platformViolation.includes('platform') &&
        platformViolation !== ownerViolation &&
        platformViolation !== slugViolation,
      platformViolation ?? 'NO VIOLATION — two links on one platform were accepted'
    );

    // ---------------------------------------------------------------- probe E
    // The losing write must not have damaged the winner.

    const survivor = await prisma.businessProfile.findUnique({
      where: { id: profileId },
      select: { businessName: true, publicSlug: true, socialLinks: { select: { id: true } } },
    });

    report(
      'E the existing row is untouched by the rejected writes',
      survivor?.businessName === 'Gate Fixture' &&
        survivor?.publicSlug === slug &&
        survivor?.socialLinks.length === 1,
      `${survivor?.businessName} / ${survivor?.publicSlug} / ${survivor?.socialLinks.length} link(s)`
    );

    // ---------------------------------------------------------------- probe F
    // Cascade, declared but never exercised until now.

    const deletedProfileId = profileId;
    await prisma.businessProfile.delete({ where: { id: deletedProfileId } });
    profileId = null;

    // Counted against the id that was just deleted — an earlier version of this
    // probe counted against a nulled variable and therefore passed vacuously.
    const orphans = await prisma.socialLink.count({
      where: { businessProfileId: deletedProfileId },
    });
    report('F deleting a profile removes its links', orphans === 0, `${orphans} orphaned link(s)`);

    // ------------------------------------------------------------ probes G–I
    // The repository's actual write shape: ONE upsert carrying a nested
    // deleteMany + create for the links.
    //
    // The unit tests mock Prisma, so they prove we build that call — not that
    // PostgreSQL accepts it or that it behaves as replacement. Every other
    // repository here uses a batched `$transaction` array, so this shape is new
    // to the project and unproven until now.

    const upsertSlug = `gate-upsert-${suffix}`;
    const writable = { businessName: 'Upsert Fixture', bio: null, publicSlug: upsertSlug, photoUrl: null, coverUrl: null };

    const first = await prisma.businessProfile.upsert({
      where: { ownerId: owner.id },
      create: {
        ownerId: owner.id,
        ...writable,
        socialLinks: {
          create: [
            { platform: 'INSTAGRAM', url: 'https://instagram.com/a', orderIndex: 0 },
            { platform: 'FACEBOOK', url: 'https://facebook.com/a', orderIndex: 1 },
          ],
        },
      },
      update: { ...writable, socialLinks: { deleteMany: {}, create: [] } },
      select: { id: true, socialLinks: { select: { platform: true }, orderBy: { orderIndex: 'asc' } } },
    });
    profileId = first.id;

    report(
      'G a nested upsert writes the profile and its links in one statement',
      first.socialLinks.length === 2,
      `${first.socialLinks.length} link(s): ${first.socialLinks.map((l) => l.platform).join(', ')}`
    );

    const replaced = await prisma.businessProfile.upsert({
      where: { ownerId: owner.id },
      create: { ownerId: owner.id, ...writable },
      update: {
        ...writable,
        socialLinks: {
          deleteMany: {},
          create: [{ platform: 'TIKTOK', url: 'https://tiktok.com/@a', orderIndex: 0 }],
        },
      },
      select: { socialLinks: { select: { platform: true } } },
    });

    report(
      'H a second save replaces the link set rather than appending to it',
      replaced.socialLinks.length === 1 && replaced.socialLinks[0]?.platform === 'TIKTOK',
      `${replaced.socialLinks.length} link(s): ${replaced.socialLinks.map((l) => l.platform).join(', ')}`
    );

    // The property the whole replacement shape exists for: applying the same
    // save twice must leave the same state, so a retry after a
    // committed-but-timed-out write cannot double the set.
    const retryUpdate = {
      ...writable,
      socialLinks: {
        deleteMany: {},
        create: [
          { platform: 'INSTAGRAM' as const, url: 'https://instagram.com/b', orderIndex: 0 },
          { platform: 'WHATSAPP' as const, url: 'https://wa.me/5491100000000', orderIndex: 1 },
        ],
      },
    };

    await prisma.businessProfile.upsert({
      where: { ownerId: owner.id },
      create: { ownerId: owner.id, ...writable },
      update: retryUpdate,
    });
    const afterRetry = await prisma.businessProfile.upsert({
      where: { ownerId: owner.id },
      create: { ownerId: owner.id, ...writable },
      update: retryUpdate,
      select: { socialLinks: { select: { platform: true } } },
    });

    report(
      'I applying the same save twice is idempotent',
      afterRetry.socialLinks.length === 2,
      `${afterRetry.socialLinks.length} link(s) after the retry — 4 would mean the set doubled`
    );
  } finally {
    if (profileId) {
      await prisma.businessProfile.delete({ where: { id: profileId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED' : `\nGATE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
