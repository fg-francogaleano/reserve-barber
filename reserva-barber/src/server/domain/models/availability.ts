/**
 * Interval algebra over instants, and the slot generation built on it.
 *
 * **Pure by construction.** Nothing here reads a clock, issues a query or
 * reaches a repository; the current instant arrives as a parameter. That is not
 * tidiness — this rule has more boundary cases than anything else in the
 * project, and "the last slot of today" is untestable if the module decides for
 * itself what "now" means.
 *
 * Everything here operates on **instants**. The conversion between the
 * business's wall clock and an instant belongs to `businessTime.ts` and happens
 * before these functions are called, so this module needs no timezone knowledge
 * and cannot get it wrong.
 */

import { SLOT_GRANULARITY_MINUTES } from './slotGranularity';

export interface Interval {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Whether two intervals share any instant, under the **half-open** convention
 * `[start, end)`: the start is inside, the end is not.
 *
 * This is the single definition every consumer uses. `docs/data-model.md` §9
 * records why it must be single: if absences and bookings disagreed about their
 * end boundary, an appointment beginning exactly when an absence ends would be
 * blocked or allowed depending on which rule ran first — and that surfaces as a
 * mysteriously unbookable slot rather than as a failing test.
 *
 * Adjacency is therefore not overlap: 09:00–10:00 and 10:00–11:00 do not
 * overlap, which is what makes back-to-back appointments possible at all.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

function isEmpty(interval: Interval): boolean {
  return interval.end.getTime() <= interval.start.getTime();
}

/**
 * Merges blockers into a minimal, ordered set of disjoint regions.
 *
 * Overlapping absences are legitimate and expected — M5b lets an owner record a
 * week off and then a specific afternoon inside it, and `docs/data-model.md` §9
 * states they "union when availability is computed". Merging first means the
 * subtraction below never sees two blockers covering the same instant, so it
 * cannot subtract the same region twice and produce an inverted interval.
 *
 * Blockers that merely touch are merged too: 11:00–13:00 and 13:00–15:00 are one
 * unavailable region, and treating them as two would leave a zero-length gap
 * between them that no appointment could ever occupy.
 */
function mergeBlockers(blockers: readonly Interval[]): Interval[] {
  const sorted = blockers
    .filter((blocker) => !isEmpty(blocker))
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];

  for (const blocker of sorted) {
    const last = merged[merged.length - 1];

    if (last !== undefined && blocker.start.getTime() <= last.end.getTime()) {
      if (blocker.end.getTime() > last.end.getTime()) {
        merged[merged.length - 1] = { start: last.start, end: blocker.end };
      }
      continue;
    }

    merged.push({ start: blocker.start, end: blocker.end });
  }

  return merged;
}

/**
 * The parts of `window` that no blocker covers, in chronological order.
 *
 * A blocker inside the window splits it in two; one covering an edge trims it;
 * one covering it entirely removes it. Blockers outside the window are ignored
 * rather than rejected — the caller passes a barber's absences and bookings for
 * a whole day against each of several windows, so "outside this window" is the
 * ordinary case, not an error.
 */
export function subtractAll(window: Interval, blockers: readonly Interval[]): Interval[] {
  if (isEmpty(window)) return [];

  const free: Interval[] = [];
  let cursor = window.start;

  for (const blocker of mergeBlockers(blockers)) {
    if (blocker.end.getTime() <= cursor.getTime()) continue;
    if (blocker.start.getTime() >= window.end.getTime()) break;

    if (blocker.start.getTime() > cursor.getTime()) {
      free.push({ start: cursor, end: blocker.start });
    }

    if (blocker.end.getTime() > cursor.getTime()) {
      cursor = blocker.end;
    }
  }

  if (cursor.getTime() < window.end.getTime()) {
    free.push({ start: cursor, end: window.end });
  }

  return free;
}

export interface SlotGenerationInput {
  /**
   * The barber's working windows for the day, already converted to instants.
   *
   * A **list**, not one window. `docs/tech-debt.md` T27 names this story: the
   * editor writes one window per day today, but the schema's unique key is
   * `(barberId, dayOfWeek, startMinute)` precisely so a split shift needs a UI
   * change and not a migration. A generator written against the editor's
   * current shape would offer 14:00 to a barber who closes for lunch.
   */
  readonly windows: readonly Interval[];
  /** Absences and blocking bookings, already filtered and merged by the caller's rules. */
  readonly blockers: readonly Interval[];
  readonly durationMinutes: number;
  readonly now: Date;
  readonly minLeadMinutes: number;
}

/**
 * The start times a client may choose, in chronological order.
 *
 * **Every candidate is anchored at the start of a free interval**, not at the
 * start of the working window. That is the difference between a cancellation
 * reopening every position it freed and reopening only those that happen to sit
 * on the window's original offsets — with a five-minute grid and a thirty-minute
 * service, six positions rather than one.
 *
 * **An appointment must fit inside one window.** This falls out of subtracting
 * per window rather than over the day: a free interval is by construction
 * contained in the window it came from, so a start whose appointment would run
 * across a lunch break is never generated. Allowing one would sell an
 * appointment through the very gap the second window exists to express.
 *
 * The grid is `SLOT_GRANULARITY_MINUTES`, the constant `slotGranularity.ts`
 * reserved for this: "slot generation (story B3) and booking sizing (story B5)
 * consume the same definition."
 */
export function generateSlots(input: SlotGenerationInput): Date[] {
  const durationMs = input.durationMinutes * 60_000;
  const stepMs = SLOT_GRANULARITY_MINUTES * 60_000;
  const earliestStart = input.now.getTime() + input.minLeadMinutes * 60_000;

  const starts: Date[] = [];

  for (const window of input.windows) {
    for (const free of subtractAll(window, input.blockers)) {
      const lastStart = free.end.getTime() - durationMs;

      for (let start = free.start.getTime(); start <= lastStart; start += stepMs) {
        // `>=` and not `>`: the cutoff instant itself is far enough away. The
        // lead time states how much notice the barber needs, and exactly that
        // much notice satisfies it.
        if (start >= earliestStart) {
          starts.push(new Date(start));
        }
      }
    }
  }

  // Windows arrive in whatever order the repository returned them, and a client
  // reads a day forwards.
  return starts.sort((a, b) => a.getTime() - b.getTime());
}
