/**
 * Guards the post-login `next` redirect against open-redirect attacks (design D8).
 * Only same-origin relative paths are honored — anything else falls back.
 */
function isSafeRedirect(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }

  return !decoded.startsWith('//') && !decoded.includes('\\');
}

export function getSafeRedirectTarget(next: string | null | undefined, fallback: string): string {
  if (!next || !isSafeRedirect(next)) {
    return fallback;
  }
  return next;
}
