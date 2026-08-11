import { TimeOff, type TimeOffPeriod } from '@/server/domain/models/TimeOff';
import type { ITimeOffRepository, NewTimeOff } from '@/server/domain/repositories/ITimeOffRepository';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * `TimeOff` has no owner column and neither does `Barber` — ownership is
 * reached through `barber.location.ownerId` (data-model.md §5).
 */
const ownedBy = (ownerId: string) => ({ location: { ownerId } });

/** What the editor needs. Never `SELECT *`. */
const EDITOR_FIELDS = { id: true, startsAt: true, endsAt: true, reason: true } as const;

/**
 * What availability needs — deliberately **without** `reason` (design D6).
 * The note can hold medical information, and a projection that does not carry
 * the field cannot leak it.
 */
const PERIOD_FIELDS = { startsAt: true, endsAt: true } as const;

export class PrismaTimeOffRepository implements ITimeOffRepository {
  constructor(private readonly db: PrismaClient) {}

  async findForBarber(barberId: string, ownerId: string): Promise<TimeOff[]> {
    const rows = await this.db.timeOff.findMany({
      where: { barberId, barber: ownedBy(ownerId) },
      select: EDITOR_FIELDS,
      // Newest first: upcoming and recent absences are what the owner came to
      // see; ascending would lead with a year of expired entries.
      orderBy: [{ startsAt: 'desc' }],
    });
    return rows.map((row) => new TimeOff(row.id, row.startsAt, row.endsAt, row.reason));
  }

  async findPeriodsForBarber(barberId: string, ownerId: string): Promise<TimeOffPeriod[]> {
    return this.db.timeOff.findMany({
      where: { barberId, barber: ownedBy(ownerId) },
      select: PERIOD_FIELDS,
      orderBy: [{ startsAt: 'asc' }],
    });
  }

  countForBarber(barberId: string, ownerId: string): Promise<number> {
    return this.db.timeOff.count({ where: { barberId, barber: ownedBy(ownerId) } });
  }

  /**
   * `createMany` with `skipDuplicates` rather than `create`, so a retry after a
   * committed-but-timed-out save is a no-op instead of a duplicate. Unlike the
   * weekly schedule there is no replacement semantics here to fall back on;
   * the unique key on (barberId, startsAt, endsAt) is what carries it.
   */
  async create(barberId: string, ownerId: string, data: NewTimeOff): Promise<void> {
    // The owner predicate cannot ride on a bulk insert, so the caller resolves
    // ownership first — the same asymmetry M4 documented for assignments.
    void ownerId;
    await this.db.timeOff.createMany({
      data: [{ barberId, startsAt: data.startsAt, endsAt: data.endsAt, reason: data.reason }],
      skipDuplicates: true,
    });
  }

  /**
   * `deleteMany`, not `delete`: matching no row must be a success rather than a
   * `P2025`. The owner predicate travels with the statement, so another owner's
   * absence is simply not matched.
   */
  async remove(id: string, ownerId: string): Promise<void> {
    await this.db.timeOff.deleteMany({ where: { id, barber: ownedBy(ownerId) } });
  }
}
