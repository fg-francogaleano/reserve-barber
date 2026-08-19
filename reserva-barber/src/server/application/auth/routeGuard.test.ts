import { describe, it, expect } from 'vitest';
import {
  decideGuardAction,
  isBookingConfirmationRoute,
  LOGIN_PATH,
  DASHBOARD_HOME,
  PUBLIC_PROFILE_ROOT,
  PUBLIC_BOOKING_API,
} from './routeGuard';

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

  describe('the public booking write', () => {
    // B4: an anonymous guest must be able to POST a provisional booking.
    // Without this entry the deny-by-default guard answers 307 to /login for
    // every guest, breaking the flow with no symptom a signed-in owner would
    // ever see.
    it('should_let_an_unauthenticated_request_reach_the_booking_write', () => {
      const action = decideGuardAction({
        hasSession: false,
        pathname: PUBLIC_BOOKING_API,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    it('should_let_an_authenticated_owner_reach_it_too', () => {
      // An owner testing their own shop's booking flow must not be redirected.
      const action = decideGuardAction({
        hasSession: true,
        pathname: PUBLIC_BOOKING_API,
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });

    // The entry is an EXACT match, never a prefix — opening `/api` as a
    // prefix would admit every future endpoint the moment it is created,
    // including the dashboard's own. These are the negative cases that prove it.
    // `/api/webhooks/mercadopago` was in this list until B5. It was the right
    // assertion at the time — B4 opened one door and proved the sibling stayed
    // shut — and B5 is the story that opens it deliberately, with its own
    // entry and its own negative cases below. Replaced rather than deleted, so
    // the property this case was testing still has a case testing it.
    it.each(['/api', '/api/', '/api/bookings/', '/api/bookings/anything', '/api/webhooks'])(
      'should_still_guard_%s_after_the_booking_write_was_opened',
      (pathname) => {
        const action = decideGuardAction({ hasSession: false, pathname, search: '' });

        expect(action).toEqual({
          type: 'redirect',
          to: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`,
        });
      }
    );

    it('should_still_guard_dashboard_paths_after_the_booking_write_was_opened', () => {
      const action = decideGuardAction({ hasSession: false, pathname: '/servicios', search: '' });

      expect(action.type).toBe('redirect');
    });
  });

  describe('the hold-confirmation namespace', () => {
    // Its URL contains a booking's cancellation token, so every response under
    // it must carry `Referrer-Policy: no-referrer` — without it B5's redirect
    // to Mercado Pago would hand a third party the credential in a header
    // nobody reads.
    it.each([
      '/b/barberia-don-juan/reserva/tok-abc',
      '/b/barberia-don-juan/reserva/tok-abc/',
      '/b/otra/reserva/AAAA-bbbb_1234',
    ])('should_recognize_%s_as_needing_no_referrer', (pathname) => {
      expect(isBookingConfirmationRoute(pathname)).toBe(true);
    });

    it.each([
      '/b/barberia-don-juan',
      '/b/barberia-don-juan/reservar',
      '/b/barberia-don-juan/reserva',
      '/b/barberia-don-juan/reserva/tok/extra',
      '/reserva/tok-abc',
    ])('should_not_apply_the_policy_to_%s', (pathname) => {
      expect(isBookingConfirmationRoute(pathname)).toBe(false);
    });

    it('should_still_be_reachable_without_a_session', () => {
      const action = decideGuardAction({
        hasSession: false,
        pathname: '/b/barberia-don-juan/reserva/tok-abc',
        search: '',
      });

      expect(action).toEqual({ type: 'continue' });
    });
  });
});

/**
 * B5's two public endpoints.
 *
 * The positive cases are what makes the story work at all — B4 measured that a
 * missing entry answers `307` to `/login`, breaking the flow for every guest
 * with no symptom an authenticated owner would ever see. The negative cases are
 * what keeps the deny-by-default guarantee: `/api` as a prefix would admit
 * every future endpoint the moment it is created, including the dashboard's.
 */
describe('the payment endpoints are named exactly', () => {
  const anonymous = { hasSession: false, search: '' };

  it('should_admit_the_payment_initiation_without_a_session', () => {
    expect(decideGuardAction({ ...anonymous, pathname: '/api/payments/mercadopago' })).toEqual({
      type: 'continue',
    });
  });

  it('should_admit_the_mercado_pago_webhook_without_a_session', () => {
    expect(decideGuardAction({ ...anonymous, pathname: '/api/webhooks/mercadopago' })).toEqual({
      type: 'continue',
    });
  });

  it.each([
    '/api',
    '/api/payments',
    '/api/webhooks',
    '/api/payments/mercadopago/extra',
    '/api/webhooks/mercadopago/extra',
    '/api/payments/stripe',
    '/api/webhooks/stripe',
    '/api/owners',
  ])('should_protect_%s', (pathname) => {
    expect(decideGuardAction({ ...anonymous, pathname })).toEqual({
      type: 'redirect',
      to: `/login?next=${encodeURIComponent(pathname)}`,
    });
  });

  it('should_not_admit_a_payment_path_carrying_an_identifier', () => {
    // The reason these endpoints take no identifier in their path: equality is
    // the match, so a tokenised path is simply not admissible. If someone ever
    // adds one, it fails here rather than silently 307-ing every guest.
    expect(
      decideGuardAction({ ...anonymous, pathname: '/api/payments/mercadopago/tok-1' })
    ).toEqual({
      type: 'redirect',
      to: `/login?next=${encodeURIComponent('/api/payments/mercadopago/tok-1')}`,
    });
  });

  it('should_still_admit_the_booking_write', () => {
    // The entry B4 added, re-asserted from this side: adding two more must not
    // disturb the one already there.
    expect(decideGuardAction({ ...anonymous, pathname: '/api/bookings' })).toEqual({
      type: 'continue',
    });
  });

  it('should_still_protect_the_barbers_namespace', () => {
    // The defect a browser check cannot catch, re-asserted because this change
    // touched the line that decides it.
    expect(decideGuardAction({ ...anonymous, pathname: '/barberos' })).toEqual({
      type: 'redirect',
      to: `/login?next=${encodeURIComponent('/barberos')}`,
    });
  });
});

/**
 * The `no-referrer` header on the confirmation route, guarded by test.
 *
 * B4 added the header for a redirect that did not exist yet: "B5's redirect to
 * Mercado Pago would carry the token to a third party in the `Referer`
 * header". B5 is that redirect, so the header is now load-bearing — and
 * removing it would break **nothing visible**. The payment would still work,
 * the tests would still pass, and a live cancellation credential would start
 * arriving at Mercado Pago in a header nobody reads.
 *
 * `middleware.ts` applies it to exactly the paths this predicate matches, so
 * the predicate is what the regression is asserted against.
 */
describe('the confirmation route is still the one that suppresses the referrer', () => {
  it.each([
    '/b/barberia-don-juan/reserva/tok-1',
    '/b/barberia-don-juan/reserva/tok-1/',
    '/b/x/reserva/aVeryLongCancellationTokenValue',
  ])('matches %s', (pathname) => {
    expect(isBookingConfirmationRoute(pathname)).toBe(true);
  });

  it('still matches after the payment routes were added beside it', () => {
    // The payment landing route sits under the same slug. It must NOT be
    // treated as the confirmation route — it carries no credential — but its
    // existence must not stop the confirmation route from being recognised.
    expect(isBookingConfirmationRoute('/b/barberia-don-juan/pago/retorno')).toBe(false);
    expect(isBookingConfirmationRoute('/b/barberia-don-juan/reserva/tok-1')).toBe(true);
  });
});
