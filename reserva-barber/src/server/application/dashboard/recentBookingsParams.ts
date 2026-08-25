import type { FilterableBarber } from '@/server/domain/models/dashboardSummary';

/**
 * Resolving the recent-bookings filter, with no I/O.
 *
 * The rule here is the one `bookingSelectionParams.ts` established for the
 * public flow — **a submitted id is matched against a list the owner's own scope
 * produced, never parsed into a query** — and it matters more here than it looks,
 * because this is the only input on the dashboard that nothing else guards.
 *
 * Every other dashboard input is a *write*, checked at the moment it is applied.
 * This one is a read filter. Passed through to `where: { barberId }`, it would
 * turn the page into an oracle: a valid foreign id returns that barber's
 * bookings and an invalid one returns nothing, which answers "does this id
 * exist" for anyone willing to ask. Matching against the loaded list removes the
 * branch that could tell the two apart.
 */

/**
 * The query parameter's name, Spanish to match the Spanish routes and the
 * booking flow's own parameters.
 */
export const RECENT_FILTER_PARAM = 'barbero';

/**
 * Ceiling applied before the value is used for anything.
 *
 * These are cuids — 25 characters. The bound is generous rather than exact, for
 * the reason `bookingSelectionParams.ts` gives about its own: its job is to
 * refuse an absurd payload cheaply, not to validate a format. What decides
 * whether a value is real is that it names a barber in the list.
 */
const MAX_ID_LENGTH = 128;

/**
 * The single value a parameter carries, or `undefined` when it carries none
 * usable.
 *
 * A repeated parameter resolves to its **first** occurrence rather than being
 * rejected — the framework hands over an array when a parameter appears more
 * than once, and a page that threw on it would break on a URL a browser or an
 * analytics rewrite produced.
 */
function single(raw: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (value === undefined || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * The barber to filter by, or `undefined` for the unfiltered list.
 *
 * **`undefined` is not an error state.** An unknown id degrades to the whole
 * list rather than to a 404 or an empty result: the filter is a convenience, and
 * a stale link to a barber who has since been removed should still show the
 * owner their recent bookings.
 */
export function resolveBarberFilter(
  raw: string | readonly string[] | undefined,
  barbers: readonly FilterableBarber[]
): string | undefined {
  const requested = single(raw);
  if (requested === undefined) return undefined;

  return barbers.some((barber) => barber.id === requested) ? requested : undefined;
}
