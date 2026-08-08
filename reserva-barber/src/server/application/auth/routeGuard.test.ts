import { describe, it, expect } from 'vitest';
import { decideGuardAction, LOGIN_PATH, DASHBOARD_HOME } from './routeGuard';

describe('decideGuardAction', () => {
  it('should_send_an_unauthenticated_visitor_to_login_carrying_the_requested_path', () => {
    const action = decideGuardAction({ hasSession: false, pathname: '/servicios', search: '' });

    expect(action).toEqual({ type: 'redirect', to: `${LOGIN_PATH}?next=%2Fservicios` });
  });

  it('should_preserve_the_query_string_in_the_next_parameter', () => {
    const action = decideGuardAction({ hasSession: false, pathname: '/clientes', search: '?tab=activos' });

    expect(action).toEqual({ type: 'redirect', to: `${LOGIN_PATH}?next=%2Fclientes%3Ftab%3Dactivos` });
  });

  it('should_let_an_unauthenticated_visitor_reach_the_login_page', () => {
    const action = decideGuardAction({ hasSession: false, pathname: LOGIN_PATH, search: '' });

    expect(action).toEqual({ type: 'continue' });
  });

  it('should_send_an_authenticated_visitor_away_from_login', () => {
    const action = decideGuardAction({ hasSession: true, pathname: LOGIN_PATH, search: '' });

    expect(action).toEqual({ type: 'redirect', to: DASHBOARD_HOME });
  });

  it('should_let_an_authenticated_visitor_through_to_a_protected_route', () => {
    const action = decideGuardAction({ hasSession: true, pathname: '/servicios', search: '' });

    expect(action).toEqual({ type: 'continue' });
  });

  it('should_guard_unknown_routes_too_rather_than_allowing_them_by_default', () => {
    const action = decideGuardAction({ hasSession: false, pathname: '/no-existe', search: '' });

    expect(action.type).toBe('redirect');
  });

  it('should_never_redirect_a_server_action_even_without_a_session', () => {
    // Redirecting a Server Action POST hands the client an HTML page where it
    // expects an encoded action result — it reports "An unexpected response was
    // received from the server" and the user is stuck until they reload.
    // The action re-checks auth itself and redirects correctly from the inside.
    const action = decideGuardAction({
      hasSession: false,
      pathname: '/',
      search: '',
      isServerAction: true,
    });

    expect(action).toEqual({ type: 'continue' });
  });

  it('should_never_redirect_a_server_action_posted_to_login_while_authenticated', () => {
    const action = decideGuardAction({
      hasSession: true,
      pathname: LOGIN_PATH,
      search: '',
      isServerAction: true,
    });

    expect(action).toEqual({ type: 'continue' });
  });

  it('should_still_guard_normal_navigations_while_actions_pass_through', () => {
    const navigation = decideGuardAction({ hasSession: false, pathname: '/', search: '' });
    const serverAction = decideGuardAction({
      hasSession: false,
      pathname: '/',
      search: '',
      isServerAction: true,
    });

    expect(navigation.type).toBe('redirect');
    expect(serverAction.type).toBe('continue');
  });

  it('should_not_let_a_crafted_path_escape_the_next_parameter', () => {
    // A path is attacker-influenced input; it must be encoded, never concatenated raw
    const action = decideGuardAction({ hasSession: false, pathname: '//evil.com', search: '' });

    expect(action).toEqual({ type: 'redirect', to: `${LOGIN_PATH}?next=%2F%2Fevil.com` });
  });
});
