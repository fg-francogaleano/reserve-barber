import { WorkingHours } from '@/server/domain/models/WorkingHours';
import type { Weekday } from '@/server/domain/models/weekday';
import type {
  IWorkingHoursRepository,
  NewWorkingWindow,
} from '@/server/domain/repositories/IWorkingHoursRepository';
import type { PrismaClient, Prisma } from '@/generated/prisma/client';

/**
 * `WorkingHours` has no owner column and neither does `Barber` — ownership is
 * reached through `barber.location.ownerId` (data-model.md §5).
 */
const ownedBy = (ownerId: string) => ({ location: { ownerId } });

/** Only the fields the domain entity carries — never `SELECT *`. */
const WINDOW_FIELDS = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
} as const;

export class PrismaWorkingHoursRepository implements IWorkingHoursRepository {
  constructor(private readonly db: PrismaClient) {}

  async findForBarber(barberId: string, ownerId: string): Promise<WorkingHours[]> {
    const rows = await this.db.workingHours.findMany({
      where: { barberId, barber: ownedBy(ownerId) },
      select: WINDOW_FIELDS,
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
    return rows.map(
      (row) => new WorkingHours(row.id, row.dayOfWeek as Weekday, row.startMinute, row.endMinute)
    );
  }

  /**
   * Replaces the barber's whole week in one batched transaction.
   *
   * Replacement rather than diff-and-append, and the difference is not stylistic.
   * A working window has no natural business key, so an additive write would
   * insert a second copy of the entire week on a retry after a
   * committed-but-timed-out save — the schedule would silently double. Deleting
   * first makes the end state depend on the submission, not on how many times it
   * was applied (design D4).
   *
   * The delete carries the owner predicate. The insert cannot: `createMany` is a
   * raw multi-row insert with no relation filter, which is why the application
   * service resolves ownership before calling and must remain the only caller —
   * the same asymmetry M4 documented for assignments.
   */
  async replaceForBarber(
    barberId: string,
    ownerId: string,
    windows: NewWorkingWindow[]
  ): Promise<void> {
    const statements: Prisma.PrismaPromise<unknown>[] = [
      this.db.workingHours.deleteMany({
        where: { barberId, barber: ownedBy(ownerId) },
      }),
    ];

    if (windows.length > 0) {
      statements.push(
        this.db.workingHours.createMany({
          data: windows.map((window) => ({
            barberId,
            dayOfWeek: window.dayOfWeek,
            startMinute: window.startMinute,
            endMinute: window.endMinute,
          })),
        })
      );
    }

    // The delete runs even for an empty week: "this barber works no days" is a
    // real save that must clear whatever was stored.
    await this.db.$transaction(statements);
  }

  async findBarberIdsWithSchedule(ownerId: string): Promise<Set<string>> {
    const rows = await this.db.workingHours.groupBy({
      by: ['barberId'],
      where: { barber: ownedBy(ownerId) },
      _count: { _all: true },
    });
    return new Set(rows.map((row) => row.barberId));
  }
}
