import type { Barber } from '@/server/domain/models/Barber';
import type { WorkingHours } from '@/server/domain/models/WorkingHours';
import type {
  IWorkingHoursRepository,
  NewWorkingWindow,
} from '@/server/domain/repositories/IWorkingHoursRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';

export interface ScheduleEditorData {
  barber: Barber;
  windows: WorkingHours[];
}

export class BarberScheduleService {
  constructor(
    private readonly schedule: IWorkingHoursRepository,
    private readonly barbers: IBarberRepository
  ) {}

  /** Returns `null` when the barber is unknown or belongs to another owner. */
  async getEditorData(ownerId: string, barberId: string): Promise<ScheduleEditorData | null> {
    const barber = await this.barbers.findByIdForOwner(barberId, ownerId);
    if (!barber) {
      return null;
    }
    return { barber, windows: await this.schedule.findForBarber(barberId, ownerId) };
  }

  /**
   * Replaces the barber's whole week.
   *
   * The ownership predicate is resolved before anything else: an unknown or
   * foreign barber must not even reveal whether a schedule exists.
   *
   * There is no "nothing changed, skip the write" shortcut here, unlike M4's
   * assignment service. A replacement is already idempotent, so skipping would
   * buy one saved round trip in exchange for a second code path that has to stay
   * correct — and an empty submission (the barber works no days) is a legitimate
   * save that must still clear whatever was stored.
   */
  async setSchedule(ownerId: string, barberId: string, windows: NewWorkingWindow[]): Promise<void> {
    const barber = await this.barbers.findByIdForOwner(barberId, ownerId);
    if (!barber) {
      throw new BarberNotFoundError();
    }
    await this.schedule.replaceForBarber(barberId, ownerId, windows);
  }
}
