import {
  formatSlotTime,
  isWithinHorizon,
  parseLocalDate,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';

/**
 * Resolution of the two parameters that name a moment rather than a row.
 *
 * These live apart from `bookingSelectionParams` for a reason that is not
 * tidiness: the catalogue selections are resolved against a structure already in
 * memory, while a time can only be resolved against the availability of the
 * barber the client just chose — which is not known until the catalogue
 * selections are settled and a query has run. The two therefore resolve in
 * sequence, not together, and both halves stay pure.
 */

/**
 * Ceiling applied before parsing. A date is 10 characters and a time is 5; the
 * bound is generous rather than exact, like `MAX_ID_LENGTH`, because its job is
 * to refuse absurd payloads cheaply rather than to validate a format.
 */
const MAX_SCHEDULE_PARAM_LENGTH = 32;

/**
 * What a parameter carries, in the three states that lead to three different
 * answers.
 *
 * `absent` and `unusable` are kept apart deliberately, and an overlong value is
 * `unusable` rather than `absent`. It would be tempting to treat a five-thousand
 * character parameter as though nobody had asked for anything — no human chose
 * it, so there is no selection to have lost. But that would make the notice's
 * *presence* distinguish a value refused for its length from one refused for its
 * content, and a stranger sweeping the parameter would read the difference. Every
 * value that is present and cannot be honoured produces the same visible answer.
 */
type RequestedParam =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unusable' }
  | { readonly kind: 'value'; readonly value: string };

/**
 * A repeated parameter resolves to its **first** occurrence rather than being
 * rejected, exactly as the catalogue selections do: appended query parameters
 * are how link shorteners and social networks rewrite URLs, and the first value
 * is the one the flow itself emitted.
 */
function single(raw: string | string[] | undefined): RequestedParam {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined || value.length === 0) return { kind: 'absent' };
  // Bounded before anything reads it — the length check is the one thing that
  // must happen before a regular expression sees a stranger's payload.
  if (value.length > MAX_SCHEDULE_PARAM_LENGTH) return { kind: 'unusable' };

  return { kind: 'value', value };
}

export interface DateSelectionResult {
  readonly date?: LocalDate;
  /**
   * True only when something was asked for and could not be honoured.
   *
   * A client who has not chosen a date yet must not be shown a notice about a
   * loss they did not suffer, so "absent" and "discarded" are different answers.
   */
  readonly discarded: boolean;
}

/**
 * The requested calendar day, or nothing.
 *
 * A date is refused for three separate reasons and they collapse into one
 * outcome on purpose: a spelling that is not canonical, a date that does not
 * exist, and a date outside `[today, today + horizon]`. The client can act on
 * none of the distinctions — in every case they are holding a link that no
 * longer names a bookable day — and reporting them differently would describe
 * the system's internals to a stranger.
 */
export function resolveDateSelection(
  raw: string | string[] | undefined,
  today: LocalDate
): DateSelectionResult {
  const requested = single(raw);
  if (requested.kind === 'absent') return { discarded: false };
  if (requested.kind === 'unusable') return { discarded: true };

  const parsed = parseLocalDate(requested.value);
  if (parsed === undefined || !isWithinHorizon(parsed, today)) {
    return { discarded: true };
  }

  return { date: parsed, discarded: false };
}

export interface SlotSelectionResult {
  readonly slot?: Date;
  readonly discarded: boolean;
}

/**
 * The requested start, **matched** against what is on offer.
 *
 * The parameter is never parsed into a time and then trusted. It is compared,
 * as a string, against the formatted list slot generation produced — so a value
 * naming a real hour that nobody can book is refused by exactly the same path as
 * a value naming no hour at all.
 *
 * That equivalence is the requirement, not a side effect: a differential answer
 * would tell anyone sweeping the parameter which times a barber has taken, on a
 * route with no rate limit.
 */
export function resolveSlotSelection(
  raw: string | string[] | undefined,
  slots: readonly Date[]
): SlotSelectionResult {
  const requested = single(raw);
  if (requested.kind === 'absent') return { discarded: false };
  if (requested.kind === 'unusable') return { discarded: true };

  const match = slots.find((slot) => formatSlotTime(slot) === requested.value);

  return match === undefined ? { discarded: true } : { slot: match, discarded: false };
}
