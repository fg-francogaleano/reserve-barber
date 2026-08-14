/**
 * Mercado Pago credential shapes — normalization and validation.
 *
 * Zero dependencies. Returns error **codes**, never Spanish strings: mapping a
 * code to a message is the presentation layer's job, and each code names a
 * distinct mistake the owner made.
 *
 * ---
 * **Two facts were read off the OAuth reference example** (2026-08-13,
 * `/developers/en/reference/authentication/oauth/_oauth_token/post`):
 *
 *   access_token: "APP_USR-4934588586838432-XXXXXXXX-241983636"
 *   public_key:   "APP_USR-d0a26210-XXXXXXXX-479f0400869e"
 *   user_id:      241983636
 *
 * **One held. Two did not.**
 *
 * ✅ **The public key's body is a UUID; the access token's is not.** Confirmed
 *    against real credentials. This is the discriminator that catches a swap
 *    (design D9), and it is the only inference in this module that survived.
 *
 * ❌ **`APP_USR-` means production.** False. The "Tus integraciones" panel
 *    issues it for test and production alike, so the environment is unknowable
 *    from the string — see `credentialEnvironment`. (Design D8, withdrawn.)
 *
 * ❌ **The token's final segment is the account id.** False. A real credential
 *    ended in 1325562541 while the owner's User ID was 156842883. The account
 *    identity now comes from Mercado Pago or not at all. (Design D6a,
 *    withdrawn; see T43.)
 *
 * The lesson is worth more than the facts: **an example in an API reference
 * describes the path that reference documents** — here, OAuth-issued
 * credentials — **not the path the user takes.** Both errors were caught only
 * because task 2.6 demanded a check against a real credential rather than
 * another fixture from the same example.
 */

export type CredentialError =
  | 'invalid_format'
  /** The two values appear to be in each other's fields (design D9). */
  | 'looks_swapped';

/**
 * Only `test` is ever asserted. There is deliberately no `production` member:
 * nothing available to this application can prove a credential is live, and a
 * type that can express it invites code to claim it. See
 * `credentialEnvironment`.
 */
export type CredentialEnvironment = 'test';

/**
 * Both prefixes are valid credential forms. `APP_USR-` is used by **both** test
 * and production credentials from the "Tus integraciones" panel, so it says
 * nothing about the environment; `TEST-` is the legacy sandbox form and is the
 * only prefix that identifies one.
 */
const PRODUCTION_PREFIX = 'APP_USR-';
const TEST_PREFIX = 'TEST-';

/**
 * A UUID body, which is what distinguishes a public key from an access token.
 * Case-insensitive: the reference shows lowercase, but a value the owner
 * retyped in uppercase is the same key and rejecting it would be wrong.
 */
const UUID_BODY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An access token body: hyphen-delimited segments of alphanumerics, at least
 * three of them, ending in the numeric account id.
 *
 * Deliberately loose about the *number* and *length* of the middle segments.
 * The reference's two examples disagree on both (one shows a redacted middle,
 * the other a date plus a hex block), and a rule tight enough to reject a real
 * token from an issuer we have not seen is worse than the swap it would catch —
 * an owner who cannot save their real credentials is fully blocked, while a
 * swap is also caught by the UUID test and by Mercado Pago itself.
 *
 * The **trailing numeric segment is required**, and that is what carries the
 * discriminating weight. Without it, a merely broken public key — a truncated
 * UUID, or one with a non-hex character — matches this pattern too, and the
 * owner is told they swapped two fields when they actually mistyped one. Each
 * mistake gets its own message, so the rule has to be able to tell them apart.
 *
 * That segment is a **shape** requirement and nothing more. It was briefly read
 * as the Mercado Pago account id; it is not one (see the header, and T43).
 */
const TOKEN_BODY = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,}-\d+$/;

const MIN_LENGTH = 20;
const MAX_LENGTH = 200;

/**
 * Strips what a paste carries invisibly (design D10).
 *
 * Owners copy from Mercado Pago's dashboard, and a trailing newline, a
 * non-breaking space or a zero-width character rides along. Such a value passes
 * every shape check below and then produces a 401 at payment time — the failure
 * is invisible at the only moment anyone is looking. This project has already
 * paid for this exact class of bug once, with a polluted `wrangler secret put`.
 *
 * Removes ALL whitespace rather than trimming: a credential has no legitimate
 * internal spaces, and a value line-wrapped by an email client would otherwise
 * be stored broken.
 */
export function normalizeCredential(raw: string): string {
  return (
    raw
      // Written as escapes, never as the characters themselves: these are
      // invisible in an editor, so a literal class would be unreviewable and
      // one stray paste inside it would silently change what is stripped.
      //
      //   \u0000-\u001F  C0 controls (includes CR and LF)
      //   \u007F-\u009F  DEL and the C1 controls
      //   \u200B-\u200F  zero-width space/joiners and directional marks
      //   \u2028-\u202F  line/paragraph separators and the bidi overrides
      //   \uFEFF         byte order mark - the S0 `wrangler secret` failure
      //
      // None can appear in a credential; all can appear in a paste.
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
      // All whitespace, not just the ends: a credential has no legitimate
      // internal spaces, and a value line-wrapped by an email client would
      // otherwise be stored broken.
      .replace(/\s+/g, '')
  );
}

function prefixOf(value: string): string | null {
  if (value.startsWith(PRODUCTION_PREFIX)) {
    return PRODUCTION_PREFIX;
  }
  if (value.startsWith(TEST_PREFIX)) {
    return TEST_PREFIX;
  }
  return null;
}

/** The body after the environment prefix, or null when there is no prefix. */
function bodyOf(value: string): string | null {
  const prefix = prefixOf(value);
  return prefix === null ? null : value.slice(prefix.length);
}

/**
 * Which Mercado Pago environment a credential belongs to, **when that can be
 * known at all** — which is usually not.
 *
 * `null` means *unknown*, and it is the answer for every `APP_USR-` credential.
 *
 * This is a correction. PC2 originally read `APP_USR-` as "production", from an
 * OAuth reference example where that holds. It does **not** hold for the
 * credentials owners actually paste: the "Tus integraciones" panel issues
 * `APP_USR-` for *both* test and production, confirmed against a real account
 * (2026-08-13). The prefix therefore identifies a test credential only in the
 * legacy `TEST-` form.
 *
 * Reporting `APP_USR-` as production was worse than reporting nothing: it put
 * the word "Producción" on a test credential, which reads as confirmation and
 * removes exactly the doubt the environment display existed to create.
 *
 * Callers MUST treat `null` as "we do not know" and say nothing, never as
 * "production".
 */
export function credentialEnvironment(value: string): CredentialEnvironment | null {
  return prefixOf(value) === TEST_PREFIX ? 'test' : null;
}

/** True when the body is a UUID — the public key's shape, not the token's. */
function hasUuidBody(value: string): boolean {
  const body = bodyOf(value);
  return body !== null && UUID_BODY.test(body);
}

function hasTokenBody(value: string): boolean {
  const body = bodyOf(value);
  return body !== null && TOKEN_BODY.test(body) && !UUID_BODY.test(body);
}

function hasPlausibleLength(value: string): boolean {
  return value.length >= MIN_LENGTH && value.length <= MAX_LENGTH;
}

/**
 * Validates a value submitted as the **access token**.
 *
 * The swap check comes first and reports its own code. An owner who transposed
 * the two fields has made one mistake, not two, and telling them their token
 * "has an invalid format" describes something they did not do — while the real
 * consequence, an access token written into the column that is served to every
 * client, goes unmentioned.
 */
export function checkAccessToken(value: string): CredentialError | null {
  if (hasUuidBody(value)) {
    return 'looks_swapped';
  }
  if (!hasPlausibleLength(value) || !hasTokenBody(value)) {
    return 'invalid_format';
  }
  return null;
}

/** Validates a value submitted as the **public key**. */
export function checkPublicKey(value: string): CredentialError | null {
  if (hasUuidBody(value)) {
    return null;
  }
  // A token's body is unmistakable, so this is a swap rather than a typo.
  if (hasTokenBody(value)) {
    return 'looks_swapped';
  }
  return 'invalid_format';
}

/**
 * True when the pair is in each other's fields. Used to report the mistake once
 * at form level instead of twice at field level.
 */
export function looksSwapped(accessToken: string, publicKey: string): boolean {
  return hasUuidBody(accessToken) && hasTokenBody(publicKey);
}

/*
 * `accountIdFromToken` was removed here (2026-08-13).
 *
 * It read the token's trailing numeric segment as the Mercado Pago account id,
 * on the strength of the OAuth reference example where `access_token` ends in
 * the same number as `user_id`. Checked against a real panel-issued credential,
 * it does not hold: the trailing segment was 1325562541 while the owner's User
 * ID is 156842883.
 *
 * So the function returned a number that identifies nothing we can name. Both
 * things built on it are gone with it — the account shown on the status panel,
 * and the account-switch warning on the confirmation (design D6a) — because a
 * comparison of two unidentified numbers can be wrong in both directions, and
 * the one it guards is the owner's money.
 *
 * The trailing segment is still REQUIRED by `TOKEN_BODY`: as a shape rule it
 * earns its place, since it is what separates a token from a malformed public
 * key. It simply is not an account.
 *
 * What replaced it: the account identity now comes from Mercado Pago itself,
 * during verification, or it is not shown at all.
 */

/**
 * The last four characters, for display and for logs.
 *
 * Four characters of a long high-entropy secret is an accepted disclosure: it
 * is what lets an owner tell a completed rotation from an uncertain one without
 * the value ever leaving the server, and what makes a rotation reconstructable
 * from the log stream (design D14).
 */
export function credentialLastFour(value: string | null): string | null {
  if (value === null || value.length < 4) {
    return null;
  }
  return value.slice(-4);
}
