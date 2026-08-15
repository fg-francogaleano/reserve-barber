import { parseAmount, type MoneyError } from '@/server/domain/models/money';
import type { DepositPolicyInput, DepositType } from '@/server/domain/models/PaymentConfig';

/**
 * Parses and validates the deposit policy.
 *
 * Returns error **codes**, never Spanish strings: mapping a code to a message
 * is the presentation layer's job, and each code names a distinct mistake. A
 * percentage rejected for its range and one rejected for being fractional
 * explain different things to the owner, so they never collapse into "invalid".
 *
 * Follows the hand-rolled parser shape every other schema module in this
 * project uses (`{ ok, data } | { ok: false, fieldErrors }`), not Zod.
 */

export type DepositTypeError = 'required' | 'invalid_type';

export type DepositValueError =
  | MoneyError
  /** A percentage outside 1–100, or a fixed amount of zero. */
  | 'out_of_range'
  /** A fractional percentage. Percentages are whole numbers. */
  | 'not_whole';

export interface DepositFieldErrors {
  type?: DepositTypeError;
  value?: DepositValueError;
}

export type DepositParseResult =
  | { ok: true; data: DepositPolicyInput }
  | { ok: false; fieldErrors: DepositFieldErrors };

export interface RawDepositInput {
  type: unknown;
  value: unknown;
}

const DEPOSIT_TYPES: readonly DepositType[] = ['FIXED', 'PERCENT'];

/** Whole digits only: rejects `12.5`, `-5`, `+5`, `1e2` and `٥٠` alike. */
const WHOLE_DIGITS = /^\d+$/;
/** A number written with a decimal separator — fractional, whatever follows it. */
const HAS_DECIMAL_SEPARATOR = /^\d+[.,]\d+$/;

export const MIN_PERCENT = 1;
export const MAX_PERCENT = 100;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolves the submitted type, which is **never** defaulted.
 *
 * The column carries a `PERCENT` default so a write belonging to another story
 * can create the row without choosing a policy. Reusing it here would turn a
 * submission that lost its type into a percentage — and a `50` meant as fifty
 * pesos, stored as fifty percent, is off by whatever the service costs.
 */
function parseType(raw: unknown): { ok: true; type: DepositType } | { ok: false; code: DepositTypeError } {
  const value = asString(raw).trim();

  if (value.length === 0) return { ok: false, code: 'required' };

  const match = DEPOSIT_TYPES.find((candidate) => candidate === value);
  if (match === undefined) return { ok: false, code: 'invalid_type' };

  return { ok: true, type: match };
}

/**
 * A whole percentage from 1 to 100.
 *
 * `not_whole` is checked before the format rule so an owner who wrote `12,5`
 * is told percentages are whole numbers, rather than that their input has an
 * invalid format — which describes a different mistake than the one they made.
 */
function parsePercent(raw: string): { ok: true; value: string } | { ok: false; code: DepositValueError } {
  if (HAS_DECIMAL_SEPARATOR.test(raw)) return { ok: false, code: 'not_whole' };
  if (!WHOLE_DIGITS.test(raw)) return { ok: false, code: 'invalid_format' };

  const numeric = Number(raw);
  if (numeric < MIN_PERCENT || numeric > MAX_PERCENT) return { ok: false, code: 'out_of_range' };

  // Normalized: "030" and "30" are the same policy and must not become two
  // different stored strings.
  return { ok: true, value: String(numeric) };
}

/**
 * A fixed amount, parsed by the shared money module so the deposit editor and
 * the service catalogue agree on what an amount is.
 *
 * Zero is rejected here rather than in `parseAmount`, because zero is a
 * perfectly valid amount in general and only meaningless as a deposit.
 */
function parseFixed(raw: string): { ok: true; value: string } | { ok: false; code: DepositValueError } {
  const parsed = parseAmount(raw);
  if (!parsed.ok) return { ok: false, code: parsed.code };

  if (Number(parsed.value) <= 0) return { ok: false, code: 'out_of_range' };

  return { ok: true, value: parsed.value };
}

/**
 * The two fields are only meaningful together, so an unusable type stops the
 * parse before the value is judged: reporting that a value is out of range
 * requires knowing which range applies.
 */
export function parseDepositPolicy(raw: RawDepositInput): DepositParseResult {
  const type = parseType(raw.type);
  if (!type.ok) {
    return { ok: false, fieldErrors: { type: type.code } };
  }

  const value = asString(raw.value).trim();
  if (value.length === 0) {
    // Never a removal. The field always renders with the stored value, so an
    // empty submission is a mistake, and treating it as a clear would leave the
    // business unable to take bookings from one keystroke (design D8).
    return { ok: false, fieldErrors: { value: 'required' } };
  }

  const parsed = type.type === 'PERCENT' ? parsePercent(value) : parseFixed(value);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: { value: parsed.code } };
  }

  return { ok: true, data: { type: type.type, value: parsed.value } };
}
