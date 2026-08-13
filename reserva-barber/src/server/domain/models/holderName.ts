import { normalizeName } from '@/server/domain/models/normalizeName';

/**
 * The account holder name shown to clients paying by transfer (design D8).
 *
 * Normalization is deliberately **not** a second implementation: it delegates
 * to `normalizeName`, which already composes to NFC and strips zero-width and
 * bidirectional control characters. Two normalization rules in one codebase
 * eventually disagree, and this project already decided what canonical text
 * means.
 */

const HOLDER_NAME_MIN_LENGTH = 2;
const HOLDER_NAME_MAX_LENGTH = 120;

/**
 * Unicode letters and combining marks, spaces, apostrophes, hyphens and
 * periods. A whitelist rather than an escaping rule: this value is rendered to
 * clients in the public flow and will later be interpolated into transactional
 * email, where output is assembled as strings. A value that cannot contain
 * markup is safe in every renderer without any of them having to be right.
 */
const HOLDER_NAME_ALLOWED = /^[\p{L}\p{M} '.-]+$/u;

export type HolderNameError = 'invalid_chars' | 'invalid_length';

export function normalizeHolderName(raw: string): string {
  return normalizeName(raw);
}

/**
 * Validates an already-normalized holder name. An empty result is NOT reported
 * here — a value that normalizes to nothing is an absent holder name, and
 * whether that is an error depends on whether a destination was given.
 */
export function checkHolderName(normalized: string): HolderNameError | null {
  if (!HOLDER_NAME_ALLOWED.test(normalized)) {
    return 'invalid_chars';
  }
  if (
    normalized.length < HOLDER_NAME_MIN_LENGTH ||
    normalized.length > HOLDER_NAME_MAX_LENGTH
  ) {
    return 'invalid_length';
  }
  return null;
}
