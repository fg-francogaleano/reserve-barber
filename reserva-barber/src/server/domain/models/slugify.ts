/**
 * Bounds on `BusinessProfile.publicSlug` (docs/data-model.md §2). Exported so
 * validation, the editor and this module all cite one source — two constants
 * that can disagree about the same limit are a defect waiting for someone to
 * change one of them.
 */
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

/**
 * The only shape a stored slug may take: lowercase alphanumerics in
 * hyphen-separated groups, with no leading, trailing or doubled hyphen.
 *
 * Every value `slugify` produces satisfies this. The pattern exists anyway
 * because the owner may type a slug directly, and validation must be able to
 * refuse it without depending on having called `slugify` first.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** U+200B–U+200D and U+FEFF — see `normalizeName`, same class of input. */
const ZERO_WIDTH_CHARACTERS = /[​-‍﻿]/g;

/** U+202A–U+202E and U+2066–U+2069 — bidi embedding, override and isolate. */
const BIDI_CONTROL_CHARACTERS = /[‪-‮⁦-⁩]/g;

/** Left behind by NFD once a base letter and its accent are separated. */
const COMBINING_MARKS = /[̀-ͯ]/g;

const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;

/**
 * Derives the canonical URL segment for a public profile.
 *
 * Applied in two places that must agree: the editor offers the result as a
 * suggestion while the owner types a business name, and the server re-applies it
 * to whatever was submitted before validating and persisting. The server's pass
 * is the authoritative one — a value the client computed is not a value the
 * server may trust.
 *
 * Canonicalizing before persistence is what makes the unique index meaningful:
 * the index compares raw bytes, so the values it compares must already be in
 * canonical form. This is the same reasoning `normalizeName` follows for entity
 * names, and it is why no case- or accent-insensitive column type is used to
 * compensate (design D10).
 *
 * Returns an empty string when the input carries no slug at all — an ordinary
 * state while the owner is still typing, and one the validation layer, not this
 * function, is responsible for refusing on submit.
 */
export function slugify(raw: string): string {
  const withoutDiacritics = raw
    // NFD splits "é" into "e" + combining acute, so the accent can be dropped
    // while the letter survives. NFC — what `normalizeName` uses — would keep
    // them fused and the whole character would be discarded as non-ASCII.
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(BIDI_CONTROL_CHARACTERS, '')
    .toLowerCase();

  const hyphenated = withoutDiacritics.replace(NON_SLUG_CHARACTERS, '-');

  // Trimmed before clamping and again after: the clamp can cut mid-group and
  // leave the trailing hyphen this rule exists to forbid.
  return trimHyphens(trimHyphens(hyphenated).slice(0, SLUG_MAX_LENGTH));
}

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}
