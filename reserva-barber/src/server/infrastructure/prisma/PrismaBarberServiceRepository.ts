import type {
  IBarberServiceRepository,
  AssignmentDiff,
} from '@/server/domain/repositories/IBarberServiceRepository';
import type { PrismaClient, Prisma } from '@/generated/prisma/client';

/**
 * Owner scoping for this table is a **join predicate**, not a column filter.
 * `BarberService` has no `ownerId`, and neither does `Barber` — ownership is
 * reached through `barber.location.ownerId` (data-model.md §5).
 */
const ownedBy = (ownerId: string) => ({ location: { ownerId } });

/**
 * Owner scope **plus** the branch being open.
 *
 * Distinct from `ownedBy` on purpose: that one answers "does this row belong to
 * the owner", this one answers "can a client reach it". The booking flow selects
 * a location first, so a barber at a deactivated branch is unreachable no matter
 * how active the barber is. Reusing the same relation traversal means the extra
 * term costs no additional query.
 */
const reachableAt = (ownerId: string) => ({ location: { ownerId, isActive: true } });

export class PrismaBarberServiceRepository implements IBarberServiceRepository {
  constructor(private readonly db: PrismaClient) {}

  async findServiceIdsForBarber(barberId: string, ownerId: string): Promise<string[]> {
    const rows = await this.db.barberService.findMany({
      where: { barberId, barber: ownedBy(ownerId) },
      select: { serviceId: true },
    });
    return rows.map((row) => row.serviceId);
  }

  /**
   * Applies the diff as one batched transaction (design D4).
   *
   * The array form is deliberate: the interactive form would hold a pooled
   * connection open across application round trips against a transaction-mode
   * pooler, which these two statements never need of each other. Proven on the
   * real pooler by `scripts/m4-gate.ts` before this code was written.
   *
   * Note what is and is not guaranteed here. The delete carries the owner
   * predicate, so it cannot reach another owner's row. The insert **cannot**:
   * `createMany` is a raw multi-row insert with no relation filter, so the
   * foreign keys prove only that both ids exist, never that they agree about
   * the owner. That is why `BarberServiceAssignmentService` validates ownership
   * before calling, and why it must remain the only caller (design D6).
   */
  async setForBarber(barberId: string, ownerId: string, diff: AssignmentDiff): Promise<void> {
    const statements: Prisma.PrismaPromise<unknown>[] = [];

    if (diff.toRemove.length > 0) {
      statements.push(
        this.db.barberService.deleteMany({
          where: {
            barberId,
            serviceId: { in: diff.toRemove },
            barber: ownedBy(ownerId),
          },
        })
      );
    }

    if (diff.toAdd.length > 0) {
      statements.push(
        this.db.barberService.createMany({
          data: diff.toAdd.map((serviceId) => ({ barberId, serviceId })),
          // A re-submitted assignment is the same intent expressed twice, not a
          // mistake to report (design D5). This also means a violation on
          // (barberId, serviceId) never reaches the application layer, which is
          // what keeps the duplicate-name translations bounded (design D13).
          skipDuplicates: true,
        })
      );
    }

    if (statements.length === 0) {
      return;
    }

    await this.db.$transaction(statements);
  }

  async countServicesByBarber(ownerId: string): Promise<Map<string, number>> {
    const rows = await this.db.barberService.groupBy({
      by: ['barberId'],
      where: { barber: ownedBy(ownerId) },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.barberId, row._count._all]));
  }

  /**
   * Backs the bookability marker, so both exclusions live here rather than at
   * the caller: a service assigned exclusively to inactive barbers, or
   * exclusively to barbers at closed branches, is not bookable
   * (`data-model.md` §6). Leaving either filter to each caller is how two
   * callers end up disagreeing about what "bookable" means.
   *
   * `countServicesByBarber` is deliberately **not** filtered this way — it
   * answers "how many services is this barber assigned to", which stays true
   * whether or not the branch is open.
   */
  async countActiveBarbersByService(ownerId: string): Promise<Map<string, number>> {
    const rows = await this.db.barberService.groupBy({
      by: ['serviceId'],
      where: {
        service: { ownerId },
        barber: { isActive: true, ...reachableAt(ownerId) },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.serviceId, row._count._all]));
  }
}
