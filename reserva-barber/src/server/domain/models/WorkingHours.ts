import type { Weekday } from './weekday';

/**
 * One recurring working window.
 *
 * `startMinute` / `endMinute` are minutes from midnight in **business local
 * time** — wall clock, never an instant (data-model.md §8). Nothing above the
 * repository converts them; conversion happens only when comparing a schedule
 * against a booking, in `businessTime`.
 */
export class WorkingHours {
  constructor(
    public readonly id: string,
    public readonly dayOfWeek: Weekday,
    public readonly startMinute: number,
    public readonly endMinute: number
  ) {}
}
