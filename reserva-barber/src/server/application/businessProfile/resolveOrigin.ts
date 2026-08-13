export interface OriginSources {
  /** An explicit override, when the deployment knows its own public address. */
  configured?: string | undefined;
  /** The request's `Host` header. */
  host?: string | undefined;
  /** The request's `X-Forwarded-Proto` header, if a proxy set one. */
  forwardedProto?: string | undefined;
}

const SUPPORTED_PROTOCOLS = new Set(['http', 'https']);
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Resolves the origin the shareable link is built on.
 *
 * Server-side, always. `window.location.origin` is undefined during server
 * rendering and produces a hydration mismatch when a client component reaches
 * for it on first paint — a real defect on the one page whose output the owner
 * is about to copy and hand to their clients (design D11).
 *
 * Returns `null` rather than guessing when nothing usable is available. The
 * editor then shows the path and says the link is not ready, which is better
 * than a confident URL pointing at the wrong host.
 */
export function resolveOrigin(sources: OriginSources): string | null {
  const configured = normalizeConfigured(sources.configured);
  if (configured !== null) return configured;

  const host = sources.host?.trim();
  if (!host) return null;

  return `${protocolFor(host, sources.forwardedProto)}://${host}`;
}

function normalizeConfigured(configured: string | undefined): string | null {
  const value = configured?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol.replace(':', ''))) return null;
    // `url.origin` drops any path and trailing slash, so a configured value with
    // either cannot produce a doubled separator in the composed link.
    return url.origin;
  } catch {
    return null;
  }
}

function protocolFor(host: string, forwardedProto: string | undefined): string {
  // Proxy chains append rather than replace, so the header can be "https,http".
  // The first entry is the protocol the client actually used.
  const forwarded = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  if (forwarded && SUPPORTED_PROTOCOLS.has(forwarded)) return forwarded;

  // Development runs without TLS, and an https link to localhost simply fails
  // to open — which would make the copy control look broken.
  return LOCAL_HOSTS.test(host) ? 'http' : 'https';
}
