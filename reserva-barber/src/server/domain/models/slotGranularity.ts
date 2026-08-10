/**
 * The granularity of the booking slot grid, in minutes.
 *
 * This lives in the **domain** layer, not in the service-catalog feature, because
 * slot generation (story B3) and booking sizing (story B5) consume the same
 * definition. Two definitions of the grid would not surface as a failing test —
 * they would surface as appointments that cannot be booked.
 *
 * 5 divides 15, 20, 30 and 45, so it constrains nothing an owner actually wants
 * to sell while still guaranteeing that a duration tiles the grid.
 */
export const SLOT_GRANULARITY_MINUTES = 5;

/** Shortest sellable service: one slot. */
export const MIN_DURATION_MINUTES = SLOT_GRANULARITY_MINUTES;

/** Eight hours — a full working day for a single appointment is already absurd. */
export const MAX_DURATION_MINUTES = 480;

// Deliberately no `isValidDuration()` predicate here. One was written and then
// removed during verification: `parseDuration` in the service schema cannot use
// a boolean, because it must report *which* rule failed (out of range vs. not a
// multiple) to render the right Spanish message. Keeping both would have meant
// two encodings of the same rule — exactly what this module exists to prevent.
// The constants are the shared definition; B3 and B5 compose them the same way.
