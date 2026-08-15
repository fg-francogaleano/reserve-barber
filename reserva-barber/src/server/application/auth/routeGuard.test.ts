import { describe, it, expect } from 'vitest';
import { decideGuardAction, LOGIN_PATH, DASHBOARD_HOME, PUBLIC_PROFILE_ROOT } from './routeGuard';

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

  describe('paths that cannot be decoded', () => {
    // Measured on the deployment runtime: `/b/barberia%` returned **500**. The
    // application's own decoding handles it and calls `notFound()`, but Next
    // decodes the path again further down and throws where nothing catches it.
    // The middleware is the only layer that runs before that, so the refusal
    // has to happen here.
    it.each(['/b/barberia%', '/b/%zz', '/b/%C3%', '/barberos%', '/%'])(
      'should_refuse_%s_rather_than_letting_it_reach_the_router',
      (pathname) => {
        expect(decideGuardAction({ hasSession: false, pathname, search: '' })).toEqual({
          type: 'reject',
        });
      }
    );

    it('should_refuse_an_undecodable_path_even_for_an_authenticated_owner', () => {
      expect(
        decideGuardAction({ hasSession: true, pathname: '/perfil%', search: '' })
      ).toEqual({ type: 'reject' });
    });

    it('should_refuse_an_undecodable_path_even_for_a_server_action', () => {
      expect(
        decideGuardAction({ hasSession: true, pathname: '/%', search: '', isServerAction: true })
      ).toEqual({ type: 'reject' });
    });

    it('should_still_allow_a_legitimately_encoded_path', () => {
      // `%C3%ADa` is a valid encoding of "ía" — refusing it would break every
      // accented business name, which is the opposite of the intent.
      expect(
        decideGuardAction({
          hasSession: false,
          pathname: '/b/barber%C3%ADa-don-juan',
          search: '',
        })
      ).toEqual({ type: 'continue' });
    });
  });

  describe('the public profile namespace', () => {
    it('should_let_an_unauthenticated_visitor_reach_a_public_profile', () => {
      const action = decideGuardAction({
        hasSession: false,
        pathname: `${PUBLIC_PROFILE_ROOT}/barberia-don-juan`,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    it('should_let_an_unauthenticated_visitor_reach_the_namespace_root', () => {
      // Permitted by the guard so the route tree answers it with a 404 of its
      // own, rather than the guard disclosing that a dashboard sits behind it.
      const action = decideGuardAction({
        hasSession: false,
        pathname: PUBLIC_PROFILE_ROOT,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    it('should_let_an_unauthenticated_visitor_reach_a_nested_public_route', () => {
      // B2 hangs the booking wizard under this prefix; it must not have to
      // revisit the guard to do so.
      const action = decideGuardAction({
        hasSession: false,
        pathname: `${PUBLIC_PROFILE_ROOT}/barberia-don-juan/reservar`,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    it('should_not_redirect_an_authenticated_owner_away_from_the_public_page', () => {
      // The owner checks their own page by opening it. Sending them to the
      // dashboard instead would leave them no way to see what clients see.
      const action = decideGuardAction({
        hasSession: true,
        pathname: `${PUBLIC_PROFILE_ROOT}/barberia-don-juan`,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    // The reason this whole block exists. `startsWith('/b')` would open every
    // one of these, and the symptom would be that the pages simply render —
    // nothing a browser check would reveal.
    it.each([
      '/barberos',
      '/barberos/brb_123/horarios',
      '/barberos/brb_123/ausencias',
      '/barberos/brb_123/servicios',
      '/barberos/nuevo',
    ])('should_still_guard_%s_after_the_public_namespace_was_opened', (pathname) => {
      const action = decideGuardAction({ hasSession: false, pathname, search: '' });

      expect(action).toEqual({
        type: 'redirect',
        to: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`,
      });
    });

    it('should_still_guard_a_path_that_merely_begins_with_the_namespace_letters', () => {
      // `/bar` is not `/b/...`. The boundary is the segment separator, not the
      // character.
      const action = decideGuardAction({ hasSession: false, pathname: '/bar', search: '' });

      expect(action.type).toBe('redirect');
    });

    it('should_still_guard_a_path_whose_first_segment_only_starts_with_b', () => {
      const action = decideGuardAction({ hasSession: false, pathname: '/bookings', search: '' });

      expect(action.type).toBe('redirect');
    });
  });
});
