import {
  findBarber,
  findLocation,
  findService,
  type BookableLocation,
  type BookableService,
  type PublicBarber,
  type PublicBookingCatalog,
} from '@/server/domain/models/BookingCatalog';

/**
 * The query parameters as they arrive. Spanish, matching the Spanish route
 * segment they live under.
 *
 * `string | string[] | undefined` is the shape Next hands over, not a
 * convenience: a repeated parameter (`?local=a&local=b`) produces an array, and
 * a module that typed this as `string | undefined` would be wrong about its own
 * input on the one route whose input comes from a stranger.
 */
export interface RawBookingSelection {
  local?: string | string[] | undefined;
  servicio?: string | string[] | undefined;
  barbero?: string | string[] | undefined;
  /** Canonical `YYYY-MM-DD`, resolved by `bookingScheduleParams`. */
  fecha?: string | string[] | undefined;
  /** `HH:mm`, matched against the generated slot list and never parsed as a time. */
  hora?: string | string[] | undefined;
}

/**
 * The steps of the flow, in order.
 *
 * `date` and `slot` sit after the catalogue selections and are **not** resolved
 * here: a date is checked against a calendar and a time against the barber's
 * availability, and neither is knowable from the catalogue alone. This function
 * therefore stops at `date`, which means "the catalogue selections are settled;
 * the schedule is next".
 */
export type BookingStep = 'location' | 'service' | 'barber' | 'date' | 'slot' | 'complete';

/** Which selection was dropped, so the page can say so without guessing. */
export type DiscardedSelection = 'location' | 'service' | 'barber' | 'date' | 'slot';

export interface BookingSelection {
  readonly location?: BookableLocation | undefined;
  readonly service?: BookableService | undefined;
  readonly barber?: PublicBarber | undefined;
}

export interface BookingSelectionResult {
  /** The step to render — always the first one that is not yet decided. */
  readonly step: BookingStep;
  readonly selection: BookingSelection;
  /**
   * Selections that were asked for and could not be honoured, outermost first.
   *
   * Non-empty means the client is holding a link that has outlived the
   * catalogue. That is the ordinary case for a URL shared on WhatsApp, not an
   * attack and not an error.
   */
  readonly discarded: readonly DiscardedSelection[];
}

/**
 * Ceiling on a raw parameter, applied before it is used for anything.
 *
 * These are cuids — 25 characters. The bound is generous rather than exact for
 * the same reason `MAX_ENCODED_SLUG_LENGTH` is: its job is to refuse absurd
 * payloads cheaply, not to validate the format. What actually decides whether a
 * value is real is that it names something in the catalogue, and that check
 * costs a lookup in an already-loaded structure.
 */
const MAX_ID_LENGTH = 128;

/**
 * The single value a parameter carries, or `undefined` when it carries none
 * usable.
 *
 * A repeated parameter is resolved to its **first** occurrence rather than
 * rejected. It is not hostile input in any interesting sense — appended query
 * parameters are how link shorteners, social networks and analytics tools
 * rewrite URLs — and the first value is the one the flow itself would have put
 * there. Rejecting the request would turn a shared link into a dead end for a
 * reason the client cannot see.
 */
function single(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * Resolves a requested selection against the catalogue, with no I/O (design D2).
 *
 * Two properties this function exists to guarantee, both from the spec:
 *
 * **Nothing is trusted.** Every id is a key into owner-scoped data supplied by a
 * stranger, and the only thing that makes one real is finding it in a catalogue
 * that was itself built under the owner's scope. An id belonging to another
 * barbershop is therefore not "rejected" through some separate path — it simply
 * is not in this catalogue, so it resolves exactly as an id that never existed
 * does. There is no branch here that could tell them apart, which is the point:
 * a differential response would answer "does this id exist" for anyone sweeping.
 *
 * **A stale selection degrades, it does not fail.** Upstream choices that still
 * resolve are kept; the first one that does not is dropped along with everything
 * below it, and the step it belonged to is what renders. Links to this route
 * live in WhatsApp threads and outlive the catalogue they were built from, so
 * this is the ordinary path, not the exceptional one. 404ing would throw away a
 * branch and a service that are both still correct, and substituting a different
 * barber would book the client with someone they did not choose.
 */
export function resolveBookingSelection(
  catalog: PublicBookingCatalog,
  raw: RawBookingSelection
): BookingSelectionResult {
  const discarded: DiscardedSelection[] = [];

  const requestedLocation = single(raw.local);
  const location =
    requestedLocation === undefined ? undefined : findLocation(catalog, requestedLocation);

  if (requestedLocation !== undefined && location === undefined) {
    discarded.push('location');
  }

  if (location === undefined) {
    // Downstream ids are not even looked at. They were chosen under a branch
    // that is no longer on offer, so they cannot be consistent with whatever the
    // client picks next — and reporting them as separately discarded would
    // describe three losses where the client made one.
    return { step: 'location', selection: {}, discarded };
  }

  const requestedService = single(raw.servicio);
  const service =
    requestedService === undefined ? undefined : findService(location, requestedService);

  if (requestedService !== undefined && service === undefined) {
    discarded.push('service');
  }

  if (service === undefined) {
    return { step: 'service', selection: { location }, discarded };
  }

  const requestedBarber = single(raw.barbero);
  const barber = requestedBarber === undefined ? undefined : findBarber(service, requestedBarber);

  if (requestedBarber !== undefined && barber === undefined) {
    discarded.push('barber');
  }

  if (barber === undefined) {
    return { step: 'barber', selection: { location, service }, discarded };
  }

  // Not `complete`: three catalogue selections no longer finish this flow. The
  // date and the time are resolved by the caller, which is the only layer that
  // can — one needs a calendar and the other needs a query.
  return { step: 'date', selection: { location, service, barber }, discarded };
}

/**
 * Whether the branch step is a real choice.
 *
 * A single offerable branch is not presented (design D13): most barbershops in
 * the target market have one, and a choice with one option asks the client to
 * confirm something they were never given a say in — on the first screen of the
 * flow that earns the business money.
 */
export function hasBranchChoice(catalog: PublicBookingCatalog): boolean {
  return catalog.length > 1;
}

/**
 * The selection to render, with a lone branch filled in.
 *
 * Applied after resolution rather than inside it so that the resolution stays a
 * pure statement about what the client asked for. The implied branch is a
 * presentation decision, and it stays changeable — it is named in the summary,
 * not hidden.
 */
export function withImpliedBranch(
  catalog: PublicBookingCatalog,
  result: BookingSelectionResult
): BookingSelectionResult {
  if (result.step !== 'location' || hasBranchChoice(catalog)) return result;

  const only = catalog[0];
  if (only === undefined) return result;

  return { step: 'service', selection: { location: only }, discarded: result.discarded };
}

/** What a step link may carry. Absent keys are omitted from the query entirely. */
export interface BookingHrefParts {
  readonly locationId?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly barberId?: string | undefined;
  /** Canonical `YYYY-MM-DD`. */
  readonly date?: string | undefined;
  /** `HH:mm` as the slot list renders it. */
  readonly time?: string | undefined;
}

/**
 * The URL for a point in the flow — the inverse of `resolveBookingSelection`,
 * which is why it lives beside it rather than in a component.
 *
 * **Downstream keys are dropped rather than carried.** Passing only a location
 * yields a URL with only `local`, so the "change branch" control cannot produce
 * a link that still names the service chosen under the previous one. The
 * resolver would discard such a service anyway; not emitting it means the client
 * is never shown a notice about a loss they did not cause.
 *
 * `URLSearchParams` does the encoding, so an id is escaped rather than
 * concatenated — these values come back to us from the URL on the next request.
 */
export function bookingStepHref(slug: string, parts: BookingHrefParts = {}): string {
  const query = new URLSearchParams();

  // Strictly nested: each key is emitted only when every key above it is
  // present. That is what makes the "change branch" control unable to produce a
  // link still naming the service — and now the date and time — chosen under the
  // previous one. The resolver would discard them anyway; not emitting them
  // means the client is never shown a notice about a loss they did not cause.
  if (parts.locationId !== undefined) query.set('local', parts.locationId);
  if (parts.locationId !== undefined && parts.serviceId !== undefined) {
    query.set('servicio', parts.serviceId);
    if (parts.barberId !== undefined) {
      query.set('barbero', parts.barberId);
      if (parts.date !== undefined) {
        query.set('fecha', parts.date);
        if (parts.time !== undefined) query.set('hora', parts.time);
      }
    }
  }

  const suffix = query.size === 0 ? '' : `?${query}`;
  return `/b/${slug}/reservar${suffix}`;
}
