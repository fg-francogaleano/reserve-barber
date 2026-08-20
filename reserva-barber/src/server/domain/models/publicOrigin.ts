/**
 * Whether an origin can actually receive a payment gateway's callback.
 *
 * **This exists because Mercado Pago validates the scheme and not the
 * reachability**, which was measured rather than assumed: a preference whose
 * `notification_url` and `back_urls` pointed at `https://localhost:8787` was
 * **accepted**, the client paid successfully, and then two things happened that
 * nobody could see coming from the code —
 *
 * 1. the browser was returned to `https://localhost:8787`, which serves plain
 *    HTTP, and got `ERR_CONNECTION_CLOSED`; and
 * 2. the notification was posted to that same unreachable address, so the
 *    booking stayed `PENDING_PAYMENT` **after a real, approved charge**.
 *
 * The money moved and nothing in the product knew. That is the worst shape a
 * failure can take in this flow, and it was introduced by a well-meaning fix:
 * before the scheme was forced to `https`, Mercado Pago refused these
 * preferences outright and the client was told up front. Making the URL
 * *syntactically* acceptable removed the only warning there was.
 *
 * So the rule is stated here instead: **a payment is never initiated against an
 * origin that cannot receive its own notification.** It fails before the
 * charge, where a failure costs nothing, rather than after it.
 *
 * This is deliberately a check on the **host**, not on live reachability. We
 * cannot dial ourselves from inside a Worker, and a DNS or HTTP probe on the
 * payment path would add a failure mode to the request it is trying to
 * protect. What it catches is the case that actually occurs: an application
 * serving a loopback or private address, which is every local run of this
 * project.
 */

/** Loopback and unspecified addresses, by name and by literal. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** Reserved suffixes that never resolve on the public internet. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'];

/**
 * RFC 1918 and link-local ranges, as they appear in a host string.
 *
 * A prefix match is enough and a full CIDR parser is not: this guards a
 * developer's own machine, not a hostile input, and the cost of a false
 * negative is the failure this module already describes rather than a breach.
 */
function isPrivateIpv4(host: string): boolean {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/**
 * True when a third party on the public internet could reach this host.
 *
 * `host` may carry a port (`localhost:8787`); it is stripped first, because a
 * port says nothing about routability and its presence would defeat every
 * comparison below.
 */
export function isPubliclyRoutableHost(host: string): boolean {
  const withoutPort = host.replace(/:\d+$/, '').toLowerCase();

  if (withoutPort.length === 0) return false;
  if (LOOPBACK_HOSTS.has(withoutPort)) return false;
  if (PRIVATE_SUFFIXES.some((suffix) => withoutPort.endsWith(suffix))) return false;
  if (isPrivateIpv4(withoutPort)) return false;

  // A bare label — `myhost`, `dev` — is a machine on somebody's LAN, never a
  // public name. Every routable host has at least one dot.
  if (!withoutPort.includes('.')) return false;

  return true;
}
