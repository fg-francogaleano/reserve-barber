/**
 * What counts as a monetary amount in this product, decided once.
 *
 * Extracted from `serviceSchema.ts` when the deposit policy (PC3) became the
 * second surface that had to parse an amount an owner typed. Two copies of a
 * money-parsing rule diverge silently — one screen accepting a value the other
 * rejects, or worse, the two reading the same string differently — and the
 * value they disagree about decides what a client is charged.
 *
 * Everything here is **string-based**. Converting to a float and back would
 * reintroduce exactly the representation error the money convention in
 * `docs/data-model.md` exists to avoid.
 */

export type MoneyError =
  | 'required'
  | 'thousands_separator'
  | 'too_many_decimals'
  | 'invalid_format'
  | 'too_large';

export type ParseAmountResult = { ok: true; value: string } | { ok: false; code: MoneyError };

/**
 * The application ceiling, deliberately **tighter** than the `Decimal(12, 2)`
 * columns it guards. Validation being stricter than the column is what makes a
 * PostgreSQL numeric overflow — which is not a typed Prisma error and would
 * surface as a generic infrastructure failure — unreachable by construction.
 */
export const MAX_PRICE = 9_999_999.99;

/**
 * Derived from `MAX_PRICE`, never hardcoded alongside it — two constants that
 * can disagree about the same limit are a defect waiting for someone to change
 * one of them.
 *
 * This is a **pre-filter**, not the rule: it exists so an absurdly long input is
 * rejected without ever being converted to a float. The numeric comparison
 * below remains the authority, and stays reachable the moment `MAX_PRICE` is
 * not a digit-boundary value (lowering it to 5,000,000 would let `9999999`
 * through this check and only that one would catch it).
 */
const MAX_PRICE_INTEGER_DIGITS = String(Math.floor(MAX_PRICE)).length;

/** `4.500`, `4,500`, `1.234.567`, `4.500,50` — a separator used for grouping. */
const THOUSANDS_GROUPED = /^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/;
/** Three or more digits after the separator: precision we refuse to round away. */
const EXCESS_DECIMALS = /^\d+[.,]\d{3,}$/;
/** The only shape we accept once the separator has been canonicalized to a dot. */
const CANONICAL_AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a submitted amount into a canonical two-decimal string, or returns the
 * reason it cannot.
 *
 * Thousands-grouped input is **refused rather than interpreted**, because it is
 * genuinely ambiguous: `4.500` is four thousand five hundred under es-AR
 * grouping and four and a half under a dot decimal, and nothing in the string
 * says which the owner meant. Guessing would be guessing about money.
 */
export function parseAmount(raw: string): ParseAmountResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) return { ok: false, code: 'required' };

  // Checked before the decimal-count rule: "4.500" matches both, and telling an
  // owner who wrote a thousands separator that they used "too many decimals"
  // explains the wrong thing.
  if (THOUSANDS_GROUPED.test(trimmed)) return { ok: false, code: 'thousands_separator' };
  if (EXCESS_DECIMALS.test(trimmed)) return { ok: false, code: 'too_many_decimals' };

  const canonicalSeparator = trimmed.replace(',', '.');
  if (!CANONICAL_AMOUNT.test(canonicalSeparator)) return { ok: false, code: 'invalid_format' };

  const [integerPart = '', fractionPart = ''] = canonicalSeparator.split('.');
  const integerDigits = integerPart.replace(/^0+(?=\d)/, '');

  // Length-checked before any numeric comparison so an absurdly long input is
  // never converted to a float at all.
  if (integerDigits.length > MAX_PRICE_INTEGER_DIGITS) return { ok: false, code: 'too_large' };

  const value = `${integerDigits}.${(fractionPart + '00').slice(0, 2)}`;
  if (Number(value) > MAX_PRICE) return { ok: false, code: 'too_large' };

  return { ok: true, value };
}

/**
 * An amount as integer cents.
 *
 * Every arithmetic operation on money in this codebase goes through here.
 * `2501.67 * 0.3` is `750.5009999999999` in IEEE-754; the same operation over
 * integer cents is exact, and the deposit calculation depends on that being
 * true for values a client is charged.
 *
 * **The fraction is padded, not assumed.** An earlier version took "already
 * canonicalized by `parseAmount`" on trust, and that trust shipped a defect:
 * the database driver returns `2000.5` for a stored `2000.50`, and reading the
 * lone `5` as five centavos turned $2000,50 into $2000,05. Fixing it at the
 * repository boundary left the trap loaded for the next caller.
 *
 * A one-digit fraction is **tenths** — `.5` is fifty centavos, not five. That
 * is arithmetic, not a convention this module is free to assume away.
 */
export function toCents(amount: string): number {
  const [integerPart = '0', fractionPart = ''] = amount.split('.');
  // Right-padded to hundredths, then truncated: the same normalization
  // `parseAmount` and `toCanonicalDecimal` apply, so all three agree on what
  // a fraction means.
  const centavos = (fractionPart + '00').slice(0, 2);
  return Number(integerPart) * 100 + Number(centavos);
}

/** Integer cents back to the canonical two-decimal string. */
export function fromCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `${whole}.${String(remainder).padStart(2, '0')}`;
}

/**
 * A canonical amount as an es-AR reader expects it: dot for thousands, comma
 * for decimals, always two decimal places.
 *
 * Formatting is presentation, but it lives here rather than in the UI because
 * it is the inverse of the parser above, and an inverse that drifts from its
 * function shows the owner a number the system does not hold.
 */
export function formatAmount(canonical: string): string {
  const [integerPart = '0', fractionPart = '00'] = canonical.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped},${fractionPart}`;
}
