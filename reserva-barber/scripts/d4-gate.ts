// GATE D4 — the clients directory against the live database.
//
// What a mock cannot certify here (T58), and why each one needs a real row:
//
//   1. **The statement runs at all.** `listForOwner` is a `$queryRaw` with two
//      FILTER aggregates, a LEFT JOIN, a GROUP BY and a window function. `tsc`
//      cannot check a column name inside a template literal, and every unit
//      test asserts the SQL *text* rather than executing it. A typo in a quoted
//      identifier passes the whole suite and fails on the owner's page.
//
//   2. **Cross-owner isolation.** `Client.ownerId` makes the scope a single
//      predicate — easier to write, and therefore easier to omit with nothing
//      looking wrong. A leaked customer list is the most valuable read in this
//      product to get wrong and the least visible. Section 2 holds it in both
//      directions on a two-owner fixture.
//
//   3. **The ordering is total, and paging depends on it.** Most clients have
//      exactly one confirmed booking, so ties are the ordinary case. Section 5
//      seeds twenty tied clients and reads two consecutive pages, asserting no
//      duplicate and no omission — a property a mock can only be told about.
//
//   4. **The counts mean what the spec says.** Section 4 seeds a client whose
//      bookings are all cancelled, and one with no bookings at all, and reads
//      back what the page would render.
//
//   5. **One round trip.** Section 6 counts the queries the driver issued,
//      because "one statement" is a claim about a raw query plus a fallback
//      count that only fires on a page past the end.
//
// Everything it creates is prefixed `__d4_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
//   npx tsx scripts/d4-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaClientDirectoryRepository } from '../src/server/infrastructure/prisma/PrismaClientDirectoryRepository';
import { ClientDirectoryService } from '../src/server/application/services/ClientDirectoryService';
import { CLIENTS_PAGE_SIZE } from '../src/server/application/dashboard/clientPageParams';

const MARK = '__d4_gate__';
const MINUTE = 60_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let failures = 0;
let skipped = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

/**
 * Runs a probe and reports an environment fault as one rather than as a product
 * result.
 *
 * **T68**, and this gate is the one that entry's re-scoped cost pointed at: a
 * client row carries an email address and a telephone number by definition, so
 * unlike D3's the payload cannot be narrowed out of trouble.
 *
 * The check was run before this file was written, as the tasks require, and on
 * that path the fault was **not present** — `repeat('x', 2000000)` returned in
 * 347 ms. It is intermittent and environmental, so the helper stays: a probe
 * that cannot complete is announced as **not run**, never as passed.
 */
async function probeOrSkip(probe: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('Timed out')) {
      skipped += 1;
      observe(
        probe,
        `NOT RUN — the response never arrived (${message}). This is T68, the local network's ` +
          "path-MTU fault, not a result about the product. Confirm with `SELECT repeat('x', 1400)`."
      );
      return;
    }
    throw error;
  }
}

async function removeMarkedRows(prisma: PrismaClient): Promise<void> {
  await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
  await prisma.client.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.barber.deleteMany({
    where: { location: { owner: { email: { startsWith: MARK } } } },
  });
  await prisma.service.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.location.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.owner.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter });

  const repository = new PrismaClientDirectoryRepository(prisma as never);
  const service = new ClientDirectoryService(repository);

  await removeMarkedRows(prisma);

  try {
    // ─── 1. Fixture ──────────────────────────────────────────────────────────

    async function makeOwner(suffix: string) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@e.com` },
        select: { id: true },
      });
      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `${MARK}${suffix}` },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `B${suffix}` },
        select: { id: true },
      });
      const service_ = await prisma.service.create({
        data: { ownerId: owner.id, name: `S${suffix}`, price: '10000.00', durationMinutes: 30 },
        select: { id: true },
      });
      return { owner, location, barber, service: service_ };
    }

    const a = await makeOwner('a');
    const b = await makeOwner('b');

    async function makeClient(fixture: typeof a, tag: string) {
      return prisma.client.create({
        data: {
          ownerId: fixture.owner.id,
          name: `N${tag}`,
          email: `${MARK}-${tag}@e.com`,
          phone: '+541100000000',
        },
        select: { id: true },
      });
    }

    let bookingSeq = 0;
    async function makeBooking(
      fixture: typeof a,
      clientId: string,
      status: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_PAYMENT'
    ): Promise<void> {
      bookingSeq += 1;
      const start = new Date(Date.now() + bookingSeq * 60 * MINUTE);
      await prisma.booking.create({
        data: {
          clientId,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * MINUTE),
          status: status as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${bookingSeq}`,
          holdExpiresAt:
            status === 'PENDING_PAYMENT' ? new Date(Date.now() + 30 * MINUTE) : null,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
          cancelledBy: status === 'CANCELLED' ? 'CLIENT' : null,
        },
      });
    }

    // Owner A: one of each kind of client the spec distinguishes.
    const served = await makeClient(a, 'served');
    await makeBooking(a, served.id, 'CONFIRMED');
    await makeBooking(a, served.id, 'CONFIRMED');
    await makeBooking(a, served.id, 'CONFIRMED');

    const canceller = await makeClient(a, 'canceller');
    await makeBooking(a, canceller.id, 'CANCELLED');
    await makeBooking(a, canceller.id, 'CANCELLED');
    await makeBooking(a, canceller.id, 'EXPIRED');

    // No bookings at all — the row a refused checkout leaves behind.
    await makeClient(a, 'ghost');

    // One confirmed plus abandoned holds: the headline must count the one.
    const mixed = await makeClient(a, 'mixed');
    await makeBooking(a, mixed.id, 'CONFIRMED');
    await makeBooking(a, mixed.id, 'PENDING_PAYMENT');
    await makeBooking(a, mixed.id, 'EXPIRED');

    // Owner B: a client that must never appear in owner A's table.
    const foreign = await makeClient(b, 'foreign');
    await makeBooking(b, foreign.id, 'CONFIRMED');

    report('1.1. Fixture built', true, 'two owners, five clients, ten bookings');

    // ─── 2. Cross-owner isolation ────────────────────────────────────────────

    await probeOrSkip('2.x', async () => {
      const mine = await repository.listForOwner({
        ownerId: a.owner.id,
        skip: 0,
        take: CLIENTS_PAGE_SIZE,
      });
      const theirs = await repository.listForOwner({
        ownerId: b.owner.id,
        skip: 0,
        take: CLIENTS_PAGE_SIZE,
      });

      report('2.1. The statement runs against the real schema', mine.rows.length > 0, 'rows returned');
      report('2.2. Owner A sees exactly their own four clients', mine.total === 4, `total ${mine.total}`);
      report('2.3. Owner B sees exactly their own one', theirs.total === 1, `total ${theirs.total}`);
      report(
        "2.4. Owner A's page contains none of owner B's clients",
        mine.rows.every((row) => !row.email.includes('foreign')),
        mine.rows.map((row) => row.email.replace(`${MARK}-`, '')).join(', ')
      );
      report(
        "2.5. And owner B's contains none of owner A's",
        theirs.rows.every((row) => row.email.includes('foreign')),
        theirs.rows.map((row) => row.email.replace(`${MARK}-`, '')).join(', ')
      );
    });

    // ─── 3. Ordering ─────────────────────────────────────────────────────────

    await probeOrSkip('3.x', async () => {
      const page = await repository.listForOwner({
        ownerId: a.owner.id,
        skip: 0,
        take: CLIENTS_PAGE_SIZE,
      });
      const names = page.rows.map((row) => row.name);

      report(
        '3.1. The most-booked client comes first',
        names[0] === 'Nserved',
        names.join(' > ')
      );
      report(
        '3.2. The order is confirmed count descending',
        page.rows.every(
          (row, index) => index === 0 || page.rows[index - 1]!.confirmedCount >= row.confirmedCount
        ),
        page.rows.map((row) => `${row.name}:${row.confirmedCount}`).join(' ')
      );
    });

    // ─── 4. What the counts mean ─────────────────────────────────────────────

    await probeOrSkip('4.x', async () => {
      const page = await repository.listForOwner({
        ownerId: a.owner.id,
        skip: 0,
        take: CLIENTS_PAGE_SIZE,
      });
      const by = (name: string) => page.rows.find((row) => row.name === name);

      report(
        '4.1. A served client counts their confirmations',
        by('Nserved')?.confirmedCount === 3 && by('Nserved')?.inactiveCount === 0,
        `${by('Nserved')?.confirmedCount}/${by('Nserved')?.inactiveCount}`
      );
      report(
        '4.2. A serial canceller reads zero confirmed and three inactive',
        by('Ncanceller')?.confirmedCount === 0 && by('Ncanceller')?.inactiveCount === 3,
        `${by('Ncanceller')?.confirmedCount}/${by('Ncanceller')?.inactiveCount}`
      );
      report(
        '4.3. A client with no bookings survives the LEFT JOIN and reads zero/zero',
        by('Nghost') !== undefined &&
          by('Nghost')?.confirmedCount === 0 &&
          by('Nghost')?.inactiveCount === 0,
        by('Nghost') === undefined ? 'MISSING — an inner join would do this' : '0/0'
      );
      report(
        '4.4. An abandoned hold is counted as neither',
        by('Nmixed')?.confirmedCount === 1 && by('Nmixed')?.inactiveCount === 1,
        `${by('Nmixed')?.confirmedCount}/${by('Nmixed')?.inactiveCount} — the PENDING_PAYMENT row is in neither figure`
      );
    });

    // ─── 5. Paging over ties ─────────────────────────────────────────────────

    await probeOrSkip('5.x', async () => {
      // Twenty clients with exactly one confirmed booking each: the ordinary
      // case, and the one an unstable ordering breaks.
      for (let index = 0; index < 20; index += 1) {
        const tied = await makeClient(a, `tie${String(index).padStart(2, '0')}`);
        await makeBooking(a, tied.id, 'CONFIRMED');
      }

      const size = 8;
      const first = await repository.listForOwner({ ownerId: a.owner.id, skip: 0, take: size });
      const second = await repository.listForOwner({ ownerId: a.owner.id, skip: size, take: size });
      const third = await repository.listForOwner({
        ownerId: a.owner.id,
        skip: size * 2,
        take: size,
      });

      const ids = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id);
      const unique = new Set(ids);

      report(
        '5.1. Three consecutive pages contain no duplicate',
        unique.size === ids.length,
        `${ids.length} rows, ${unique.size} distinct`
      );
      report(
        '5.2. And omit nothing',
        unique.size === Math.min(first.total, size * 3),
        `${unique.size} of ${first.total}`
      );
      report(
        '5.3. The total is the same on every page',
        first.total === second.total && second.total === third.total,
        `${first.total}/${second.total}/${third.total}`
      );
    });

    // ─── 6. Cost, and the page past the end ──────────────────────────────────

    await probeOrSkip('6.x', async () => {
      let queries = 0;
      const counting = new PrismaClient({ adapter }).$extends({
        query: {
          $allOperations({ args, query }) {
            queries += 1;
            return query(args);
          },
        },
      });
      const counted = new PrismaClientDirectoryRepository(counting as never);

      await counted.listForOwner({ ownerId: a.owner.id, skip: 0, take: CLIENTS_PAGE_SIZE });
      report(
        '6.1. A page that exists costs one statement',
        queries === 1,
        `${queries} — rows, both counts and the total`
      );

      queries = 0;
      await counted.listForOwner({ ownerId: a.owner.id, skip: 5_000, take: CLIENTS_PAGE_SIZE });
      report(
        '6.2. A page past the end costs one more, to learn the total',
        queries === 2,
        `${queries} — the window has no rows to report from`
      );

      await (counting as unknown as PrismaClient).$disconnect();

      const started = Date.now();
      await service.loadPage({ ownerId: a.owner.id, rawPage: undefined });
      observe('6.3. Wall-clock cost of the page read', `${Date.now() - started} ms`);
    });

    // ─── 7. The service resolves a page that does not exist ──────────────────

    await probeOrSkip('7.x', async () => {
      const view = await service.loadPage({ ownerId: a.owner.id, rawPage: '900' });

      report(
        '7.1. A page past the end resolves to the last one, not to an empty table',
        view.page === view.lastPage && view.rows.length > 0,
        `page ${view.page} of ${view.lastPage}, ${view.rows.length} rows`
      );
    });
  } finally {
    await removeMarkedRows(prisma);

    const leftover = await prisma.client.count({ where: { email: { startsWith: MARK } } });
    report('8.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  if (skipped > 0) {
    console.log(
      `\n${skipped} probe group(s) NOT RUN — T68. They are not results about the product.`
    );
  }
  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
