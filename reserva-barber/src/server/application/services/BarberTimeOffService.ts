import type { Barber } from '@/server/domain/models/Barber';
import type { TimeOff } from '@/server/domain/models/TimeOff';
import type { ITimeOffRepository, NewTimeOff } from '@/server/domain/repositories/ITimeOffRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { TimeOffLimitReachedError } from '@/server/domain/errors/TimeOffErrors';

/**
 * Advisory per-barber cap, counting **every** absence.
 *
 * Not a guarantee: the count and the insert are separate round trips against a
 * transaction-mode pooler, so concurrent creates can exceed it (recorded as
 * T30). Unlike the service cap it counts all rows rather than active ones —
 * an absence has no active flag — which is why the parser's one-year backward
 * bound matters: it stops past absences accumulating without end.
 */
export const MAX_TIME_OFF_PER_BARBER = 100;

export interface TimeOffEditorData {
  barber: Barber;
  absences: TimeOff[];
}

export class BarberTimeOffService {
  constructor(
    private readonly timeOff: ITimeOffRepository,
    private readonly barbers: IBarberRepository
  ) {}

  /** Returns `null` when the barber is unknown or belongs to another owner. */
  async getEditorData(ownerId: string, barberId: string): Promise<TimeOffEditorData | null> {
    const barber = await this.barbers.findByIdForOwner(barberId, ownerId);
    if (!barber) {
      return null;
    }
    return { barber, absences: await this.timeOff.findForBarber(barberId, ownerId) };
  }

  async recordAbsence(ownerId: string, barberId: string, data: NewTimeOff): Promise<void> {
    // Ownership first: an unknown or foreign barber must not reveal whether
    // absences exist, nor how many.
    const barber = await this.barbers.findByIdForOwner(barberId, ownerId);
    if (!barber) {
      throw new BarberNotFoundError();
    }

    const count = await this.timeOff.countForBarber(barberId, ownerId);
    if (count >= MAX_TIME_OFF_PER_BARBER) {
      throw new TimeOffLimitReachedError();
    }

    await this.timeOff.create(barberId, ownerId, data);
  }

  /**
   * Removing an absence that is already gone is a success, not an error: from
   * the owner's point of view it is gone either way, and two open tabs must not
   * produce a failure. The owner predicate travels with the delete itself.
   */
  async removeAbsence(ownerId: string, timeOffId: string): Promise<void> {
    await this.timeOff.remove(timeOffId, ownerId);
  }
}
