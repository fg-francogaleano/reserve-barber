import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One definition of "may this client cancel", and three callers (C1).
 *
 * The rule `blocksAvailability` established and `isCancellableByOwner` restated:
 * the control that renders, the layer that attempts the write, and the write's
 * own rejection all need this answer, and three copies of a status list are
 * three chances for a control to appear where the write refuses.
 *
 * **A source-level test, because a behavioural one cannot see this.** Every
 * caller could hold its own correct copy and the whole suite would stay green —
 * right up until one of them was edited.
 */
const root = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const PAGE = 'app/b/[slug]/reserva/[token]/page.tsx';
const REPOSITORY = 'src/server/infrastructure/prisma/PrismaBookingRepository.ts';
const DOMAIN = 'src/server/domain/models/Booking.ts';

describe('the client-cancellation predicate has one home', () => {
  it('should_be_defined_exactly_once', () => {
    const definitions = root(DOMAIN).match(/export function isCancellableByClient/g);

    expect(definitions).toHaveLength(1);
  });

  it.each([PAGE, REPOSITORY])('should_be_imported_rather_than_restated_in_%s', (path) => {
    expect(root(path)).toMatch(/isCancellableByClient/);
  });

  /**
   * The specific drift this prevents: a caller listing the statuses itself.
   * `PENDING_APPROVAL` is the exclusion most likely to be re-expressed, because
   * it is the one rule a reader would not predict from the owner's version.
   */
  it.each([PAGE, REPOSITORY])('should_not_re-express_the_exclusion_in_%s', (path) => {
    const source = root(path);
    const withoutImports = source.replace(/^import[\s\S]*?;$/gm, '');

    expect(withoutImports).not.toMatch(/status\s*!==\s*'PENDING_APPROVAL'/);
  });

  /**
   * And the dependency that makes it narrower than availability by
   * construction rather than by coincidence.
   */
  it('should_be_built_on_the_availability_predicate', () => {
    const source = root(DOMAIN);
    const body = source.slice(source.indexOf('export function isCancellableByClient'));

    expect(body).toMatch(/blocksAvailability\(booking, now\)/);
  });
});
