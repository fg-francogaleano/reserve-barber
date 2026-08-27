/**
 * The two rules every outbound message shares: escape what goes in a body, and
 * keep control characters out of anything that becomes a header.
 *
 * **Extracted at the second caller, not the first.** N1 wrote both of these
 * inside the confirmation builder, which was right while there was one message.
 * C2 adds a second, and two copies of an escaping rule is how one of them stops
 * being fixed when the other is.
 */

/**
 * The five characters that change the meaning of markup, plus the quotes,
 * because an escaped value can land inside an attribute.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whether a code point is a C0 control character or DEL.
 *
 * **Deliberately not a regex character class.** The first version of this was
 * one, and it was correct and unreadable: written with literal control bytes it
 * renders in most tools as `[ -]`, indistinguishable from the range *space to
 * hyphen* — a class that would silently strip `!"#$%&'()*+,-` from every
 * legitimate subject. A comparison on the code point cannot be misread, and it
 * needs no lint suppression to exist.
 */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f;
}

/**
 * Make a value safe to place in a header.
 *
 * A CR or LF inside a subject is a second message with an attacker-chosen
 * recipient. Shop names are owner-supplied — authenticated, which is not the
 * same as trusted with the bytes of a header this product sends on their
 * behalf — and client names are guest-supplied outright.
 *
 * Controls collapse to a space rather than vanishing, so that `A\r\nB` reads as
 * `A B` and not as the single word `AB`.
 */
export function headerSafe(value: string): string {
  let stripped = '';
  for (const character of value) {
    stripped += isControl(character.codePointAt(0) ?? 0) ? ' ' : character;
  }
  return stripped.replace(/\s+/g, ' ').trim();
}
