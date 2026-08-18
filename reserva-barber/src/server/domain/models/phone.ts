/**
 * Guest contact phone: tolerant on input, canonical on storage (design D6).
 *
 * This is deliberately narrower than a general phone-number library. The one
 * consumer is a barbershop's guest-contact channel — a number the owner will
 * call or message on WhatsApp — so every accepted input is normalized to a
 * single **mobile** E.164-shaped form (`+549` + the 10-digit national number),
 * even when the input carried no explicit mobile marker. A genuine AR landline
 * typed here is stored as if it were a mobile number. That is a deliberate
 * simplification for this product's one use case, not a general-purpose rule,
 * and it is the reason this module lives beside `cbu.ts` rather than claiming
 * to be a general E.164 parser.
 *
 * Argentina's national significant number (area code + subscriber) is always
 * exactly **10 digits**, regardless of how the area code and subscriber
 * lengths split — that invariant is what makes the parsing below possible
 * without an area-code table.
 */

export type PhoneError = 'invalid_chars' | 'invalid_length';

/** What a client might type or paste: digits, an optional leading `+`, and separators. */
const ALLOWED_CHARS = /^[+\d\s().-]+$/;

/** Kept only to detect a leading `+`; stripped along with every other separator next. */
const SEPARATORS = /[\s().-]/g;

const AR_COUNTRY_CODE = '54';
const NSN_LENGTH = 10;
/** area code + "15" (old mobile marker) + subscriber, still exactly NSN_LENGTH + 2. */
const NSN_WITH_LEGACY_MOBILE_MARKER_LENGTH = NSN_LENGTH + 2;
/** The shortest real Argentine area codes are two digits (e.g. Buenos Aires "11"). */
const MIN_AREA_CODE_LENGTH = 2;
const MAX_AREA_CODE_LENGTH = 4;

function stripLegacyMobileMarker(digits: string): string | null {
  for (let areaCodeLength = MIN_AREA_CODE_LENGTH; areaCodeLength <= MAX_AREA_CODE_LENGTH; areaCodeLength += 1) {
    if (digits.slice(areaCodeLength, areaCodeLength + 2) === '15') {
      return digits.slice(0, areaCodeLength) + digits.slice(areaCodeLength + 2);
    }
  }
  return null;
}

/**
 * Parses tolerant AR phone input into the canonical stored form, or reports
 * why it could not.
 *
 * Accepted spellings include a `+54` country code, a leading trunk `0`, an
 * embedded legacy `15` mobile marker, and `+549…` already in E.164 shape —
 * with spaces, dashes, dots and parentheses anywhere as separators. Rejection
 * happens **only** when the resulting digits cannot form a 10-digit Argentine
 * national number; punctuation and spelling are never the reason.
 */
export function parsePhone(raw: string): { canonical: string } | { error: PhoneError } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { error: 'invalid_length' };
  }
  if (!ALLOWED_CHARS.test(trimmed)) {
    return { error: 'invalid_chars' };
  }

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(SEPARATORS, '').replace(/^\+/, '');

  if (hasPlus) {
    if (!digits.startsWith(AR_COUNTRY_CODE)) {
      return { error: 'invalid_length' };
    }
    digits = digits.slice(AR_COUNTRY_CODE.length);
  }

  // The trunk "0" is purely a domestic-dialing marker and never part of the
  // subscriber number, so a single leading one is always safe to drop.
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // "9" ahead of a bare 10-digit NSN is the E.164 mobile marker some clients
  // paste from WhatsApp. The legacy "15" marker (handled below) is the same
  // fact spelled the old way and is never combined with this one.
  if (digits.length === NSN_LENGTH + 1 && digits.startsWith('9')) {
    digits = digits.slice(1);
  }

  let nsn: string;
  if (digits.length === NSN_LENGTH) {
    nsn = digits;
  } else if (digits.length === NSN_WITH_LEGACY_MOBILE_MARKER_LENGTH) {
    const withoutMarker = stripLegacyMobileMarker(digits);
    if (withoutMarker === null) {
      return { error: 'invalid_length' };
    }
    nsn = withoutMarker;
  } else {
    return { error: 'invalid_length' };
  }

  if (!/^\d{10}$/.test(nsn)) {
    return { error: 'invalid_length' };
  }

  return { canonical: `+549${nsn}` };
}
