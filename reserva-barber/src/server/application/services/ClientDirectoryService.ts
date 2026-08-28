import {
  CLIENTS_PAGE_SIZE,
  clampToLastPage,
  lastPageFor,
  resolveRequestedPage,
  skipFor,
} from '@/server/application/dashboard/clientPageParams';
import type {
  ClientDirectoryRow,
  IClientDirectoryRepository,
} from '@/server/domain/repositories/IClientDirectoryRepository';

/** What the clients page renders. */
export interface ClientDirectoryView {
  readonly rows: readonly ClientDirectoryRow[];
  /** The page actually shown, which may not be the one that was asked for. */
  readonly page: number;
  readonly lastPage: number;
  readonly total: number;
}

/**
 * Composes the directory read with the paging rule.
 *
 * The split is the one `PublicAvailabilityService` and `BarberCalendarService`
 * follow: everything deciding *which page* is in `clientPageParams.ts`,
 * testable without a database, and what lives here is the part that cannot be
 * pure — reading rows, and reacting to a total it could not know in advance.
 *
 * **The paging has two clamps and they are not redundant.** The first, in the
 * resolver, stops a submitted number becoming an absurd `OFFSET` — the database
 * will honour one by walking and discarding rows. The second, here, needs the
 * real total, which only the read can supply. So a page past the end costs a
 * second read: the first returns nothing and the total, the second returns the
 * page the owner should have been on.
 *
 * That is one extra round trip on a request nobody makes by hand, and it is the
 * price of keeping the ordinary case at a single statement. Resolving to the
 * last page rather than rendering an empty table is not a nicety: an empty
 * result on page nine hundred looks exactly like a shop with no clients, and
 * those are different facts the page states differently.
 */
export class ClientDirectoryService {
  constructor(private readonly clients: IClientDirectoryRepository) {}

  async loadPage(input: {
    ownerId: string;
    rawPage: string | readonly string[] | undefined;
  }): Promise<ClientDirectoryView> {
    const requested = resolveRequestedPage(input.rawPage);

    const first = await this.clients.listForOwner({
      ownerId: input.ownerId,
      skip: skipFor(requested),
      take: CLIENTS_PAGE_SIZE,
    });

    const resolved = clampToLastPage(requested, first.total);

    if (resolved === requested) {
      return {
        rows: first.rows,
        page: resolved,
        lastPage: lastPageFor(first.total),
        total: first.total,
      };
    }

    // Only reachable for a page past the end, where the first read returned no
    // rows and the total that says which page does exist.
    const corrected = await this.clients.listForOwner({
      ownerId: input.ownerId,
      skip: skipFor(resolved),
      take: CLIENTS_PAGE_SIZE,
    });

    return {
      rows: corrected.rows,
      page: resolved,
      lastPage: lastPageFor(corrected.total),
      total: corrected.total,
    };
  }
}
