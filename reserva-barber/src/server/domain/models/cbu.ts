/**
 * Bank transfer destination rules: CBU/CVU and alias (design D2, D3, D4).
 *
 * Pure arithmetic and string handling, no dependencies — this module is the one
 * place in the project where a data-entry mistake costs money rather than
 * convenience, so it is kept trivially testable and free of infrastructure.
 */

/** Separators a home-banking copy/paste realistically carries. */
const DESTINATION_SEPARATORS = /[\s.-]/g;

const DIGITS_ONLY = /^\d+$/;

const CBU_LENGTH = 22;
const BLOCK_1_LENGTH = 8;

/**
 * BCRA "clave 10, ponderador 9713". Block 1 is 7 digits plus a check digit
 * (3 bank + 4 branch); block 2 is 13 account digits plus a check digit.
 *
 * These weights are load-bearing and were verified against a fully worked
 * example before being trusted: CBU 2850590940090418135201 sums to 81 in block
 * one (check digit 9) and 139 in block two (check digit 1). A wrong table here
 * rejects valid accounts, which is a worse failure than the typo the check
 * exists to catch — see design D2.
 */
const BLOCK_1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3] as const;
const BLOCK_2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

export type CbuError = 'invalid_chars' | 'invalid_length' | 'invalid_checksum';
export type AliasError = 'invalid_chars' | 'invalid_length';

const ALIAS_MIN_LENGTH = 6;
const ALIAS_MAX_LENGTH = 20;
const ALIAS_ALLOWED = /^[a-z0-9.-]+$/;
const ALIAS_EDGE_SEPARATOR = /^[.-]|[.-]$/;

/**
 * Strips the separators a pasted value carries. Deliberately does NOT strip
 * every non-digit: doing so would turn a value containing letters into a
 * shorter numeric one and report it as a length problem, which explains the
 * wrong mistake to the owner.
 */
export function normalizeCbu(raw: string): string {
  return raw.replace(DESTINATION_SEPARATORS, '');
}

function checkDigitOf(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += Number(digits[index]) * weights[index];
  }
  // (10 - n) alone yields 10 when the sum ends in 0; the outer modulo maps that
  // back to 0, which is what the BCRA rule states.
  return (10 - (sum % 10)) % 10;
}

function blockIsValid(block: string, weights: readonly number[]): boolean {
  const body = block.slice(0, weights.length);
  const stated = Number(block[weights.length]);
  return checkDigitOf(body, weights) === stated;
}

/**
 * Validates an already-normalized CBU/CVU. Returns the reason it failed, or
 * `null` when it is valid. CBUs and CVUs share the format, so one rule covers
 * both.
 *
 * Reasons are distinct on purpose: a value rejected for its length and one
 * rejected for its check digits describe different mistakes, and collapsing
 * them into "invalid" tells the owner nothing actionable.
 */
export function checkCbu(normalized: string): CbuError | null {
  if (!DIGITS_ONLY.test(normalized)) {
    return 'invalid_chars';
  }
  if (normalized.length !== CBU_LENGTH) {
    return 'invalid_length';
  }

  const blockOne = normalized.slice(0, BLOCK_1_LENGTH);
  const blockTwo = normalized.slice(BLOCK_1_LENGTH);

  if (!blockIsValid(blockOne, BLOCK_1_WEIGHTS) || !blockIsValid(blockTwo, BLOCK_2_WEIGHTS)) {
    return 'invalid_checksum';
  }
  return null;
}

/**
 * The alias namespace is case-insensitive and canonically lowercase, so casing
 * is normalized away rather than preserved (design D4). Storing what the owner
 * happened to type produces "the transfer doesn't work" reports when their
 * client's bank rejects the casing.
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Validates an already-normalized alias. There is no checksum to apply — the
 * format carries no check digit, which is precisely why changing a stored
 * destination requires an explicit confirmation (design D14).
 */
export function checkAlias(normalized: string): AliasError | null {
  if (!ALIAS_ALLOWED.test(normalized)) {
    return 'invalid_chars';
  }
  if (normalized.length < ALIAS_MIN_LENGTH || normalized.length > ALIAS_MAX_LENGTH) {
    return 'invalid_length';
  }
  if (ALIAS_EDGE_SEPARATOR.test(normalized)) {
    return 'invalid_chars';
  }
  return null;
}

/** Groups a stored CBU into blocks of four for display (design D3). */
export function formatCbu(normalized: string): string {
  return normalized.replace(/(.{4})/g, '$1 ').trim();
}

/** The only part of a destination that may reach the log stream (design D9). */
export function cbuLastFour(normalized: string | null): string | null {
  return normalized ? normalized.slice(-4) : null;
}
