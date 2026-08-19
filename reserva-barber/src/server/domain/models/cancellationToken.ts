/**
 * The client's only credential for their booking: the URL segment authorizing
 * the hold-confirmation page (design D10), and later the cancellation link N1
 * emails.
 *
 * Generated, never derived. A token built from the booking's id, the client's
 * data or a timestamp is a token an attacker who knows those facts can
 * reconstruct — the column's uniqueness constraint is what turns a collision
 * into a write failure rather than one client reaching another's booking, and
 * that constraint only means something if the values it guards are actually
 * random.
 */

const TOKEN_BYTES = 32; // 256 bits

/** URL-safe base64: no padding, no `+`/`/` that would need escaping in a path segment. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCancellationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return toBase64Url(bytes);
}
