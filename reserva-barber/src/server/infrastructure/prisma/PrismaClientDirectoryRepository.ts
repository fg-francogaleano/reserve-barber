import type {
  ClientDirectoryPage,
  IClientDirectoryRepository,
} from '@/server/domain/repositories/IClientDirectoryRepository';
import type { PrismaClient } from '@/generated/prisma/client';

/** One row of the directory statement. Counts arrive as `bigint`. */
interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  confirmedCount: bigint;
  inactiveCount: bigint;
  total: bigint;
}

export class PrismaClientDirectoryRepository implements IClientDirectoryRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * One page of this owner's clients, their counts and the total, from **one
   * statement**.
   *
   * ---
   *
   * **Why this is raw SQL rather than the query builder**, since that is the
   * first question a reader will have and the answer is a real limitation:
   *
   * Prisma can *select* a filtered relation count, but it cannot **order by**
   * one. `orderBy: { bookings: { _count: 'desc' } }` takes no `where`, so the
   * only ordering the builder offers here is by *every* booking — which is a
   * count of checkout attempts, the exact figure D1 refused to report. An
   * ordering that ranks a client with four abandoned holds above one who has
   * been served twice is not the table this story asked for.
   *
   * D1 reached for `$queryRaw` for the same class of reason and recorded the
   * cost: `tsc` cannot check a column name inside a template literal, and a
   * typo in a quoted identifier passes the entire unit suite and fails on the
   * owner's page. That is what `scripts/d4-gate.ts` exists for (T58).
   *
   * Every interpolation is a tagged-template parameter, never string
   * concatenation.
   *
   * ---
   *
   * **`count(*) OVER ()` is the total**, and it is why this is one statement
   * rather than two. Window functions are evaluated after grouping and before
   * `LIMIT`, so it counts the owner's clients rather than the page's rows.
   *
   * The one case it cannot answer is a page **past the end**: no rows come
   * back, so there is no window to read a total from. That path — and only
   * that path — pays for a `COUNT`, which the caller then uses to resolve the
   * page it should have asked for. It costs a round trip on a request nobody
   * makes by hand, and it keeps the common case at one statement.
   *
   * A `LEFT JOIN` rather than an inner one, deliberately: **a client with no
   * bookings at all is a real row this table must show.** The booking flow
   * creates the client before it writes the booking and outside any shared
   * transaction, so a refused submission leaves one behind. An inner join
   * would hide exactly the rows the spec requires to be visible.
   */
  async listForOwner(input: {
    ownerId: string;
    skip: number;
    take: number;
  }): Promise<ClientDirectoryPage> {
    const { ownerId, skip, take } = input;

    const rows = await this.db.$queryRaw<DirectoryRow[]>`
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,

        -- Confirmations, not rows. A row count is a count of checkout
        -- attempts: abandoned holds accumulate without bound relative to real
        -- business, so a client who never paid would rank alongside one who
        -- has been served ten times.
        count(b.id) FILTER (WHERE b.status = 'CONFIRMED') AS "confirmedCount",

        -- The disambiguator, not a statistic. Without it, a failed checkout
        -- and a client who cancelled three times both read as zero — opposite
        -- facts about a person. CANCELLED and EXPIRED are summed because the
        -- difference between a decision and a deadline is D5's question.
        count(b.id) FILTER (WHERE b.status IN ('CANCELLED', 'EXPIRED'))
          AS "inactiveCount",

        -- Evaluated after grouping and before LIMIT, so this is the owner's
        -- client count rather than the page's row count.
        count(*) OVER () AS "total"

      FROM "Client" c
      -- LEFT: a client with no bookings is a row this table must show.
      LEFT JOIN "Booking" b ON b."clientId" = c.id
      -- The whole tenancy boundary. There is no row-level security here, and
      -- Client carries ownerId directly, so this single predicate is it.
      WHERE c."ownerId" = ${ownerId}
      GROUP BY c.id
      -- The tiebreaker is correctness, not tidiness: most clients have exactly
      -- one confirmed booking, so ties are the ordinary case, and without a
      -- unique final key the same client appears on two pages while another
      -- appears on none.
      ORDER BY count(b.id) FILTER (WHERE b.status = 'CONFIRMED') DESC, c.id ASC
      LIMIT ${take} OFFSET ${skip}
    `;

    if (rows.length === 0) {
      // No window to read a total from. At offset zero that means the shop has
      // no clients; past it, the caller asked for a page that does not exist
      // and needs the real total to resolve the one that does.
      const total = skip === 0 ? 0 : await this.db.client.count({ where: { ownerId } });
      return { rows: [], total };
    }

    return {
      // `Number` on a count is exact well past any plausible client volume,
      // and these figures are small by construction.
      total: Number(rows[0]!.total),
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        confirmedCount: Number(row.confirmedCount),
        inactiveCount: Number(row.inactiveCount),
      })),
    };
  }
}
