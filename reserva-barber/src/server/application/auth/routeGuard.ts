export const LOGIN_PATH = '/login';
export const DASHBOARD_HOME = '/';

export interface GuardRequest {
  hasSession: boolean;
  pathname: string;
  search: string;
  /** True for Server Action requests, which carry a `Next-Action` header. */
  isServerAction?: boolean;
}

export type GuardAction = { type: 'continue' } | { type: 'redirect'; to: string };

/**
 * Decides what the route guard should do, isolated from Next.js so the policy
 * is directly testable (design D3). Deny-by-default: every route except the
 * login page requires a session, so a new route is protected the moment it
 * exists rather than when someone remembers to add it to a list.
 *
 * Server Actions are the one exception, and not for convenience: an action POST
 * expects an encoded action result, so answering it with a redirect to an HTML
 * page breaks the client ("An unexpected response was received from the
 * server") and leaves the user stuck until they reload. Actions are instead
 * guarded from the inside by `requireOwner()`, whose `redirect()` Next.js
 * encodes in a form the client can follow — layer 3 of the guard doing exactly
 * the job it exists for.
 */
export function decideGuardAction({
  hasSession,
  pathname,
  search,
  isServerAction = false,
}: GuardRequest): GuardAction {
  if (isServerAction) {
    return { type: 'continue' };
  }

  const isLoginRoute = pathname === LOGIN_PATH;

  if (!hasSession && !isLoginRoute) {
    const next = encodeURIComponent(`${pathname}${search}`);
    return { type: 'redirect', to: `${LOGIN_PATH}?next=${next}` };
  }

  if (hasSession && isLoginRoute) {
    return { type: 'redirect', to: DASHBOARD_HOME };
  }

  return { type: 'continue' };
}
