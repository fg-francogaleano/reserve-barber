import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * N2's schema change, asserted rather than trusted.
 *
 * Two of these tests exist because of a hazard that is specific to this story
 * and invisible in a diff: **`Booking` now carries two email-instant columns
 * whose semantics are opposite.** `confirmationEmailSentAt` documents in bold
 * that it is *not* an idempotency key — at-most-once there is a property of the
 * confirming conditional update, and nothing reads the column before sending.
 * `reminderEmailSentAt` **is** the idempotency key, because a job triggered by
 * time passing has no transition to key on.
 *
 * A reader who meets either column first will generalise to the other and be
 * wrong. The doc comment is the only thing standing between them, so a test
 * holds it in place.
 *
 * The rest follows `schemaUnchangedByC1.test.ts` and N1's package-manifest
 * test: the cheapest guarantee is the one a test can state.
 */
const SCHEMA_PATH = join(process.cwd(), 'prisma', 'schema.prisma');
const MIGRATIONS_PATH = join(process.cwd(), 'prisma', 'migrations');

const schema = readFileSync(SCHEMA_PATH, 'utf8');

function reminderMigration(): string {
  const directory = readdirSync(MIGRATIONS_PATH).find((entry) =>
    /^\d{14}_.*reminder/.test(entry)
  );
  expect(directory, 'the reminder migration should exist').toBeDefined();
  return readFileSync(join(MIGRATIONS_PATH, directory as string, 'migration.sql'), 'utf8');
}

describe('N2 schema — the reminder column', () => {
  it('should_declare_the_column_zone_aware_at_creation', () => {
    // The convention `startTime` states and `data-model.md` names as the failure
    // mode of omission: Prisma's DateTime default is a zone-LESS timestamp,
    // which is wrong for anything compared against a human's clock.
    expect(schema).toContain('reminderEmailSentAt DateTime? @db.Timestamptz(3)');
  });

  it('should_name_its_neighbour_and_state_that_the_two_are_opposite', () => {
    // The hazard this whole file exists for. Not a style check: a reader who
    // applies N1's rule to this column removes the only thing making the
    // reminder at-most-once.
    const declaration = schema.indexOf('reminderEmailSentAt DateTime? @db.Timestamptz(3)');
    const previous = schema.lastIndexOf('confirmationEmailSentAt DateTime? @db.Timestamptz(3)');

    // Bound the window before slicing it. Without this, an absent column makes
    // `indexOf` return -1, `slice` spans the rest of the file, and the two
    // assertions below pass against unrelated text somewhere else in the
    // schema — a test that reports success for a column that does not exist.
    expect(declaration, 'the reminder column should be declared').toBeGreaterThan(-1);
    expect(previous, 'the confirmation column should precede it').toBeGreaterThan(-1);
    expect(previous).toBeLessThan(declaration);

    const comment = schema.slice(previous, declaration);

    expect(comment).toContain('confirmationEmailSentAt');
    expect(comment).toMatch(/idempotency key/i);
  });

  it('should_name_the_partial_index_in_the_block_listing_what_prisma_cannot_declare', () => {
    // B7's two partial indexes get the same treatment, for the same reason: a
    // schema file mistaken for the whole truth is how an index silently stops
    // existing.
    expect(schema).toContain('Booking_reminder_due');
  });
});

describe('N2 schema — the migration', () => {
  it('should_create_the_partial_index_with_both_predicate_clauses', () => {
    const sql = reminderMigration();

    // Both clauses, not one. `status = 'CONFIRMED'` alone would keep every
    // reminded booking in the index forever; the null test alone would keep
    // every cancelled and expired one.
    expect(sql).toMatch(/CREATE INDEX[\s\S]*"Booking_reminder_due"/);
    expect(sql).toMatch(/WHERE[\s\S]*status = 'CONFIRMED'[\s\S]*"reminderEmailSentAt" IS NULL/);
  });

  it('should_add_a_nullable_column_and_change_no_data', () => {
    const sql = reminderMigration();

    expect(sql).toMatch(/ALTER TABLE "Booking" ADD COLUMN\s+"reminderEmailSentAt"/);

    // Comments stripped before scanning, because the migration EXPLAINS why it
    // performs no backfill and the explanation necessarily contains the words
    // it is banning. The first version of this assertion scanned the whole file
    // and failed on its own rationale — the same limitation D7 recorded about a
    // substring scan that cannot tell a comment from a call, and B7's about one
    // that cannot tell English from a status slug.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    // No backfill, deliberately. Null is correct in both directions: a future
    // confirmed booking becomes a candidate, and a past one is excluded by the
    // capability's own `startTime > now` bound. A backfill here would either
    // mark the future as already reminded and silence the feature permanently,
    // or leave the past eligible — both unrecoverable.
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\b/i);

    // And the scan must still be able to see a statement, or it proves nothing.
    expect(statements).toMatch(/\bCREATE INDEX\b/);
  });
});
