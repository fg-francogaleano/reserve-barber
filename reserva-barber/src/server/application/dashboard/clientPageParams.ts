/**
 * Resolving which page of the clients table is shown, with no I/O.
 *
 * The rule is the one `recentBookingsParams.ts` established and
 * `barberCalendarParams.ts` followed — **bound it, resolve it, and degrade
 * rather than fail** — with one addition specific to paging.
 *
 * **A page number becomes a database offset, and an offset is honoured.**
 * `?pagina=999999999` is not refused by PostgreSQL; it is obeyed, by walking
 * and discarding rows. So the value is bounded **twice**: once here, before it
 * can become a `skip` at all, and again against the real total once that is
 * known, which is also what makes a page past the end resolve to the last page
 * rather than to an empty table.
 *
 * The two clamps answer different questions and neither replaces the other.
 * The first is about what the database may be asked to do on behalf of a
 * parameter somebody typed; the second is about what the owner should see.
 */

/** The query parameter's name, Spanish to match the Spanish routes. */
export const CLIENTS_PAGE_PARAM = 'pagina';

/**
 * How many clients a page shows.
 *
 * **A judgement, not a measurement** — the family this project keeps naming
 * rather than scattering, after the bounds in `bookingHorizon.ts`, the slot
 * granularity, `RECENT_BOOKINGS_LIMIT` and the calendar's past window.
 *
 * Sized so a page fills a phone screen without turning the table into a paging
 * exercise, and so the response stays modest against a connection pool the
 * public booking flow shares (T47).
 */
export const CLIENTS_PAGE_SIZE = 25;

/**
 * The highest page this table will ask the database for.
 *
 * Also a judgement, and the reason it is small: `MAX_CLIENTS_PAGE *
 * CLIENTS_PAGE_SIZE` is the largest offset any request can produce. A shop with
 * more clients than that has outgrown an offset-paged directory rather than
 * this constant — see design D5, which accepts offset paging knowingly and
 * names keyset paging as the successor.
 */
export const MAX_CLIENTS_PAGE = 1_000;

/**
 * Ceiling applied before the value is used for anything.
 *
 * Generous rather than exact, for the reason the other resolvers give about
 * their own: its job is to refuse an absurd payload cheaply, not to validate a
 * format.
 */
const MAX_PAGE_LENGTH = 16;

/** Digits only. No sign, no decimal point, no exponent, no surrounding space. */
const CANONICAL_PAGE = /^[0-9]+$/;

/**
 * The single value a parameter carries, or `undefined` when it carries none
 * usable.
 *
 * A repeated parameter resolves to its **first** occurrence rather than being
 * rejected: the framework hands over an array when a parameter appears more
 * than once, and a page that threw on it would break on a URL a browser or a
 * rewrite produced.
 */
function single(raw: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (value === undefined || value.length === 0 || value.length > MAX_PAGE_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * The page the caller asked for: at least one, at most `MAX_CLIENTS_PAGE`.
 *
 * Anything unusable degrades to the first page — never a 404, never a throw.
 * A page number is a convenience, and losing the table over a mangled link
 * would trade a small wrong answer for no answer at all.
 *
 * A value **above** the ceiling is clamped rather than discarded: somebody
 * asking for page nine hundred million wants the end of the list, and the
 * second clamp will take them to the real last page.
 */
export function resolveRequestedPage(raw: string | readonly string[] | undefined): number {
  const value = single(raw);
  if (value === undefined || !CANONICAL_PAGE.test(value)) return 1;

  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1) return 1;

  return Math.min(page, MAX_CLIENTS_PAGE);
}

/**
 * The last page that exists for a total.
 *
 * **Never zero.** A shop with no clients still renders its empty state, and
 * "page 0 of 0" is not a state this page can describe.
 */
export function lastPageFor(total: number): number {
  return Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));
}

/**
 * The page to actually render, once the real total is known.
 *
 * A page past the end resolves to the **last** page rather than to an empty
 * table, because an empty result on page nine hundred is indistinguishable
 * from a shop that has no clients — and those are different facts the page
 * states differently.
 */
export function clampToLastPage(requested: number, total: number): number {
  return Math.min(requested, lastPageFor(total));
}

/** The offset a page starts at. */
export function skipFor(page: number): number {
  return (page - 1) * CLIENTS_PAGE_SIZE;
}

/**
 * The link to one page of the table.
 *
 * The first page carries **no parameter**: the unparameterised URL is the
 * canonical one and the one the navigation points at, so a "first page" link
 * that added `?pagina=1` would make two URLs for one view.
 */
export function clientPageHref(page: number): string {
  return page <= 1 ? '/clientes' : `/clientes?${CLIENTS_PAGE_PARAM}=${page}`;
}
