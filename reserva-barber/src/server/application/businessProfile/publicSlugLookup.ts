// `SLUG_MAX_LENGTH` is deliberately not imported: the column bound is enforced
// by `slugify`, which truncates, not by this module. See MAX_ENCODED_SLUG_LENGTH.
import { slugify, SLUG_MIN_LENGTH, SLUG_PATTERN } from '@/server/domain/models/slugify';

/**
 * What to do with the slug a stranger put in the URL.
 *
 * `reject` means the value cannot be a stored slug, so **no query is issued**.
 * `lookup` carries the canonical form to search for, plus whether the request
 * already used it — which is what decides between rendering and redirecting.
 */
export type PublicSlugLookup =
  | { type: 'reject' }
  | { type: 'lookup'; slug: string; isCanonical: boolean };

/**
 * Ceiling on the RAW route parameter, before decoding.
 *
 * Generous on purpose: it exists to refuse absurd payloads, not to enforce the
 * column bound. A 60-character name of accented characters encodes to 360, so
 * anything at or below this cannot be a legitimate slug that was merely
 * percent-encoded — and anything above it is not worth normalizing to find out.
 */
const MAX_ENCODED_SLUG_LENGTH = 512;

/**
 * Decides how to resolve a requested public slug, with no I/O (B1 design D4).
 *
 * **One query, not two.** Stored slugs are always canonical (P1 design D10), so
 * a non-canonical request cannot match exactly — normalizing first means the
 * single lookup answers both the render case and the redirect case, instead of
 * an exact attempt followed by a retry on the miss path, which is the path an
 * enumeration would hammer.
 *
 * The bounds check runs before anything else because the route parameter is the
 * one value in this feature supplied entirely by a stranger, and it is
 * unbounded while the column is not.
 *
 * `slugify` is reused rather than reimplemented. If a second rule existed here
 * and the two ever drifted, a slug the owner successfully saved would become
 * unreachable at the URL derived from the same input — a failure with no error
 * message anywhere.
 */
export function decidePublicSlugLookup(raw: string): PublicSlugLookup {
  // Cheap ceiling, deliberately NOT `SLUG_MAX_LENGTH`.
  //
  // Its only job is to refuse absurd payloads before doing any work. Testing
  // the raw value against the column's 60 looks stricter and is simply wrong:
  // percent-encoding inflates every accented character from 1 to 6, so
  // "Peluquería y Estética Íntegra de Ñuñoa" — 38 characters, normalizing to a
  // perfectly valid 38-character slug — arrives as 73 and would be rejected
  // before anyone looked at it. Every accented business name long enough is
  // affected, which is the same failure D20 exists to prevent, one step earlier.
  //
  // The real bound is enforced after normalization: `slugify` truncates to
  // `SLUG_MAX_LENGTH`, so no canonical value can exceed the column.
  if (raw.length === 0 || raw.length > MAX_ENCODED_SLUG_LENGTH) {
    return { type: 'reject' };
  }

  // **The route parameter arrives percent-encoded.** Measured on the deployment
  // runtime, not assumed: `/b/Barbería-Don-Juan-Centro` reached this function as
  // `Barber%C3%ADa-Don-Juan-Centro`, which `slugify` turned into
  // `barber-c3-ada-don-juan-centro` — a slug nobody has, so a link that should
  // have redirected 404'd instead. Decoding is what makes the accented spelling
  // of a shop's own name resolve.
  const decoded = decode(raw);
  if (decoded === null) {
    return { type: 'reject' };
  }

  // A slug is one path segment and carries no control characters. Checked
  // AFTER decoding, because `%2F` and `%00` are exactly how these arrive when
  // someone is trying to smuggle them past a check like this one.
  if (decoded.includes('/') || decoded.includes('\0') || decoded.includes('..')) {
    return { type: 'reject' };
  }

  const canonical = slugify(decoded);

  if (canonical.length < SLUG_MIN_LENGTH || !SLUG_PATTERN.test(canonical)) {
    return { type: 'reject' };
  }

  // Compared against the value **as it arrived**, not against the decoded one.
  // `/b/barberia-don-juan` and `/b/barberia%2Ddon%2Djuan` name the same shop,
  // and only the first is the canonical URL — comparing after decoding would
  // serve both, which is the second address per shop that D4 exists to prevent.
  //
  // This cannot loop: the redirect target is the canonical slug, which arrives
  // unencoded and equal to itself.
  return { type: 'lookup', slug: canonical, isCanonical: canonical === raw };
}

/**
 * `decodeURIComponent`, but `null` instead of a thrown `URIError`.
 *
 * A malformed sequence — a bare `%`, or `%zz` — is not a slug anyone holds; it
 * is someone probing. Returning `null` lets the caller refuse it on the same
 * path as every other unusable value rather than turning a stranger's typo into
 * an unhandled exception on a public page.
 */
function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
