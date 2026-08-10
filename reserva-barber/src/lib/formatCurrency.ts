/**
 * Formats a canonical price string as es-AR currency.
 *
 * `Intl` is used directly, with no fallback: the M3 gate measured
 * `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` on the
 * `workerd` runtime and it resolves the real locale, producing `$ 4.500,50`.
 * Full ICU is present — see `docs/s0-versions-decision.md` → "M3 gate result".
 * The hand-written formatter held in reserve was not needed.
 *
 * **Server-only by convention.** Call this from Server Components. Formatting the
 * same value on both sides of the RSC boundary invites a hydration mismatch,
 * since the build's locale data and the browser's need not agree.
 */
const formatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(canonicalPrice: string): string {
  return formatter.format(Number(canonicalPrice));
}
