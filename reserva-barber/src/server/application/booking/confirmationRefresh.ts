import { BOOKING_OUTCOME_PARAM } from './bookingOutcome';

/**
 * Whether the awaiting-confirmation state refreshes itself, and where to (T62).
 *
 * **A pure function with a case table, for the same reason
 * `resolvePaymentPageState` is one**: the part of this that is easy to get
 * wrong is the bound, not the rendering. An attempt counter that is not clamped
 * is a refresh loop on a page anyone can open with any URL they like, and a
 * bound expressed inside JSX is a bound nobody can prove.
 *
 * **Why this exists at all.** B5 wrote the awaiting state with no refresh and an
 * instruction to reload by hand, on the reasoning that a spinner implying an
 * update that never comes is worse than a plain sentence. That reasoning was
 * right and its premise did not survive measurement: the browser redirect from
 * Mercado Pago is a direct navigation while the notification is a
 * server-to-server call on Mercado Pago's own schedule, so the redirect wins
 * essentially every time. The state B5 designed as a careful fallback is what
 * nearly every client sees, which left the single most important moment in this
 * product — learning whether an appointment is real — ending in "please
 * refresh".
 *
 * So the update becomes real, and the spinner becomes honest with it.
 *
 * **No JavaScript.** The whole public flow works without it, so the refresh is
 * a server-rendered `<meta http-equiv="refresh">` and the counter travels in
 * the URL. Client-side polling was rejected for needing script; holding the
 * response until the notification lands was rejected for pinning a Worker
 * request on a third party's timing.
 */

/** The query parameter carrying the attempt number. Spanish, like the others. */
export const CONFIRMATION_REFRESH_PARAM = 'intento';

/**
 * Three attempts: the arrival, and two refreshes.
 *
 * Roughly ten seconds in total, which covers the ordinary notification delay
 * without hammering a page when a notification is never coming — the case where
 * the client has to be told plainly rather than spun at.
 */
export const MAX_REFRESH_ATTEMPTS = 3;

export const REFRESH_INTERVAL_SECONDS = 5;

/**
 * The parameters a refresh may carry forward (C1).
 *
 * Everything else is dropped. The two here are the ones this page owns: the
 * outcome code it renders wording from, and the counter this module sets.
 *
 * An allowlist rather than a denylist, because the failure mode of forgetting
 * to deny is a parameter that silently rides a timed navigation, and the
 * failure mode of forgetting to allow is a parameter that stops surviving a
 * refresh — visible immediately, and harmless.
 */
const REFRESHABLE_PARAMS: ReadonlySet<string> = new Set([
  BOOKING_OUTCOME_PARAM,
  CONFIRMATION_REFRESH_PARAM,
]);

export interface ConfirmationRefresh {
  /** Seconds to wait before reloading. */
  readonly seconds: number;
  /** Where to reload, relative. Same page, counter advanced. */
  readonly url: string;
}

export interface ConfirmationRefreshInput {
  /**
   * The raw `intento` value, **exactly as the framework produced it** — which
   * includes `string[]` for a repeated parameter, and that is the point.
   *
   * An earlier version took `string | undefined` and left the page to flatten
   * an array first. The page flattened it to `undefined`, which this module
   * reads as "first arrival" rather than as malformed — so `?intento=2&intento=2`
   * restarted the counter, while this module's own test asserted an array was
   * malformed. **The test was true of the module and false of the only caller**,
   * which is the same shape of gap a mock leaves behind. Widening the type is
   * what makes the table below describe what actually reaches it.
   */
  readonly attempt: string | string[] | undefined;
  /** The current path and query, relative. */
  readonly currentUrl: string;
}

/**
 * A strict positive integer, or `null`.
 *
 * **Strict, and deliberately not `parseInt`.** `parseInt('2.5')` is `2` and
 * `parseInt('2abc')` is `2`, so a lenient parse would quietly accept values
 * that were never a counter this page emitted. Anything that is not exactly a
 * run of digits is treated as malformed — and malformed means "render the
 * terminal state", which is the safe direction: the page stops refreshing.
 *
 * `Number` alone would accept `'0x2'`, `' 2 '` and `'2e0'`; the digit test
 * comes first so none of those reach it.
 */
function parseAttempt(raw: string | string[]): number | null {
  // An array is a repeated parameter. This page emits exactly one `intento`
  // per refresh, so a repeated one was not produced here and is not a value to
  // interpret — it is the obvious way somebody would try to defeat the clamp.
  if (typeof raw !== 'string') return null;
  if (!/^\d+$/.test(raw)) return null;

  const value = Number(raw);
  return value >= 1 ? value : null;
}

/**
 * The refresh to emit, or `null` for the terminal state.
 *
 * `null` covers every way this can end: the bound is reached, the counter is
 * malformed, the counter is out of range, or somebody hand-edited it. All of
 * them render the manual instruction, which is exactly the behaviour this page
 * had before T62 — so the worst case of a forged parameter is the old page.
 */
export function resolveConfirmationRefresh(
  input: ConfirmationRefreshInput
): ConfirmationRefresh | null {
  // An absent counter is the first arrival — the one case where a missing
  // value is not malformed. Everything else, including a repeated parameter,
  // goes through the strict parse.
  const attempt = input.attempt === undefined ? 1 : parseAttempt(input.attempt);

  if (attempt === null || attempt >= MAX_REFRESH_ATTEMPTS) return null;

  return {
    seconds: REFRESH_INTERVAL_SECONDS,
    url: withAttempt(input.currentUrl, attempt + 1),
  };
}

/**
 * The same URL with the counter set, **and nothing this page does not own**.
 *
 * **Set, never appended.** Appending would grow the URL on every hop and leave
 * two values for one parameter — at which point the clamp reads whichever the
 * framework happens to hand over first, and stops being a clamp.
 *
 * **The allowlist is C1's, and it fixes a defect this function shipped with.**
 * The caller rebuilds the current URL from every parameter it was routed with,
 * so anything present rode along on a timed navigation. That was harmless while
 * this page owned every parameter it could see; C1 adds one that opens a
 * confirmation panel, and a refresh carrying it would re-enter that panel every
 * five seconds while the client read an irreversible warning. Stripping happens
 * **here** rather than at the caller because this module owns the refresh: a
 * caller cannot defeat a rule it does not apply.
 *
 * Parsed against a placeholder origin because `URL` requires one, and the
 * result is re-serialised relative: an absolute URL here would need a real
 * origin, and the only place a host could come from is the request, which this
 * flow does not trust for exactly the reason the public profile page records.
 */
function withAttempt(currentUrl: string, attempt: number): string {
  const url = new URL(currentUrl, 'https://placeholder.invalid');

  for (const key of [...url.searchParams.keys()]) {
    if (!REFRESHABLE_PARAMS.has(key)) url.searchParams.delete(key);
  }

  url.searchParams.set(CONFIRMATION_REFRESH_PARAM, String(attempt));
  return `${url.pathname}${url.search}`;
}
