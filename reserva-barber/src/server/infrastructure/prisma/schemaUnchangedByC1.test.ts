import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANCELLED_BY } from '@/server/domain/models/Booking';

/**
 * C1 adds no migration, and this asserts it rather than trusting it.
 *
 * The cancellation columns and the `CancelledBy` enum have existed since B3;
 * C2 was their first writer and C1 is their second. A story that stores a value
 * an enum already declares needs no schema change — but "we didn't mean to add
 * one" is exactly the kind of claim that quietly stops being true, and on a
 * project whose migrations run against a shared database an unintended one is
 * expensive to discover late.
 *
 * The N1 test asserting `package.json` byte-identical is the same idea: the
 * cheapest guarantee is the one a test can state.
 */
const SCHEMA_PATH = join(process.cwd(), 'prisma', 'schema.prisma');
const MIGRATIONS_PATH = join(process.cwd(), 'prisma', 'migrations');

describe('C1 changes no schema', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');

  it('should_find_the_cancellation_columns_already_declared', () => {
    expect(schema).toContain('cancelledAt   DateTime?    @db.Timestamptz(3)');
    expect(schema).toContain('cancelledBy   CancelledBy?');
  });

  it('should_find_CLIENT_already_a_member_of_the_enum', () => {
    // The value C1 becomes the first to store. Declared since B3, written by
    // nothing until now.
    expect(schema).toMatch(/enum CancelledBy \{\s*OWNER\s*CLIENT\s*\}/);
  });

  it('should_agree_with_the_domain_module_about_the_enum', () => {
    // The domain declares this list rather than importing it from the generated
    // client, so the two can drift. They must not.
    for (const value of CANCELLED_BY) {
      expect(schema).toMatch(new RegExp(`enum CancelledBy \\{[^}]*\\b${value}\\b[^}]*\\}`));
    }
  });

  it('should_add_no_migration_of_its_own', () => {
    const migrations = readdirSync(MIGRATIONS_PATH).filter((entry) => /^\d{14}_/.test(entry));

    // Named rather than counted: a count would have to be edited by every
    // later story, and would fail for the wrong reason when one legitimately
    // adds a migration.
    expect(migrations.filter((name) => name.includes('c1'))).toEqual([]);
    expect(migrations.filter((name) => name.includes('cancel'))).toEqual([]);
  });
});
