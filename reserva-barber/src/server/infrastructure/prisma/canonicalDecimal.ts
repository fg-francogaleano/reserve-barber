/**
 * The **only** place a driver decimal is turned into a domain string.
 *
 * The M3 gate measured what happens when one escapes: it does not throw at the
 * RSC boundary — `JSON.stringify` yields `"4500.5"`, silently dropping the
 * second decimal. So this conversion is not a convenience, it is the thing that
 * keeps a money value from reading two different ways in two different places.
 *
 * PC3 proved the same failure a second time, against the live database: a
 * deposit stored as `2000.50` came back as `2000.5`, and integer-cent
 * arithmetic then read the lone `5` as five centavos. Extracted here at that
 * second call site — the alternative was a second conversion in another
 * repository, drifting from this one.
 *
 * Never routes through `Number`: coercing a money value to a float and back
 * reintroduces exactly the representation error the `Decimal` column exists to
 * avoid. A string from the driver is padded textually instead.
 */
export function toCanonicalDecimal(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return (value as { toFixed(digits: number): string }).toFixed(2);
  }
  const [integerPart = '0', fractionPart = ''] = String(value).split('.');
  return `${integerPart}.${(fractionPart + '00').slice(0, 2)}`;
}
