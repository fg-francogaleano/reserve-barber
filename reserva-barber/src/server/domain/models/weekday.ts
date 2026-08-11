/**
 * The storage index and the display order disagree on purpose, and that
 * disagreement lives here alone.
 *
 * `dayOfWeek` is 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()` and
 * `data-model.md` §8. But es-AR reads a week starting on **Monday**, so the
 * editor must render Monday first while storing Sunday as 0. Two encodings of
 * the same week in two files is how a schedule ends up shifted by a day.
 */

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** es-AR reading order: Monday first, Sunday last. */
export const WEEKDAY_DISPLAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function isWeekday(value: unknown): value is Weekday {
  // Integer check is not pedantry: 0.5 satisfies a naive range comparison and
  // then matches no day, so the window it carries would be silently discarded
  // while the save reported success.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}
