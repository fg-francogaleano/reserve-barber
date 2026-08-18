import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { BOOKING_ECHO_COOKIE } from '@/server/application/booking/bookingOutcome';

const create = vi.fn();

vi.mock('./bookingCreationService', () => ({
  bookingCreationService: () => ({ create }),
}));

vi.mock('@/server/infrastructure/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST } = await import('./route');
const { logger } = await import('@/server/infrastructure/logger');

const SLUG = 'barberia-don-juan';

const HELD = {
  id: 'bkg-1',
  cancellationToken: 'tok-abc',
  startTime: new Date('2026-08-17T12:00:00.000Z'),
  endTime: new Date('2026-08-17T12:30:00.000Z'),
  holdExpiresAt: new Date('2026-08-17T12:15:00.000Z'),
  depositAmount: '1000.00',
};

function form(overrides: Record<string, string> = {}): FormData {
  const body = new FormData();
  const fields = {
    slug: SLUG,
    locationId: 'loc-centro',
    serviceId: 'svc-corte',
    barberId: 'bar-ana',
    fecha: '2026-08-17',
    hora: '09:00',
    name: 'Ana Pérez',
    email: 'ana@mail.com',
    phone: '11 5555-4444',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body;
}

/** A unique origin per request, so one test's throttle never trips another's. */
let originCounter = 0;
function request(body: FormData, headers: Record<string, string> = {}) {
  originCounter += 1;
  return new Request('https://reserva.test/api/bookings', {
    method: 'POST',
    body,
    headers: { 'cf-connecting-ip': `198.51.100.${originCounter % 250}`, ...headers },
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ outcome: 'created', booking: HELD });
});

describe('POST /api/bookings - success', () => {
  it('should_redirect_to_the_confirmation_page_addressed_by_the_cancellation_token', async () => {
    const response = await POST(request(form()));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(`/b/${SLUG}/reserva/tok-abc`);
  });

  it('should_answer_a_repeat_submission_identically_to_a_first_one', async () => {
    // The whole point of the idempotency rule: a client who double-tapped must
    // not be able to tell that they did.
    const first = await POST(request(form()));

    create.mockResolvedValue({ outcome: 'alreadyHeld', booking: HELD });
    const second = await POST(request(form()));

    expect(second.status).toBe(first.status);
    expect(second.headers.get('location')).toBe(first.headers.get('location'));
  });

  it('should_use_303_so_a_reload_reissues_a_get_rather_than_the_post', async () => {
    const response = await POST(request(form()));

    expect(response.status).toBe(303);
  });

  it('should_clear_a_stale_echo_cookie_on_success', async () => {
    const response = await POST(request(form()));

    expect(response.cookies.get(BOOKING_ECHO_COOKIE)?.value).toBe('');
  });

  it('should_return_a_json_envelope_when_json_is_requested', async () => {
    const response = await POST(request(form(), { accept: 'application/json' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { redirectTo: expect.stringContaining('tok-abc') },
    });
  });
});

describe('POST /api/bookings - the six outcomes are distinguishable', () => {
  it('should_send_a_lost_race_back_to_the_time_step', async () => {
    create.mockResolvedValue({ outcome: 'slotTaken' });

    const response = await POST(request(form()));
    const location = response.headers.get('location') ?? '';

    expect(response.status).toBe(303);
    expect(location).toContain('estado=horario');
    // The time is dropped; everything upstream survives, because their next
    // action is picking another time.
    expect(location).not.toContain('hora=');
    expect(location).toContain('local=loc-centro');
    expect(location).toContain('servicio=svc-corte');
    expect(location).toContain('barbero=bar-ana');
    expect(location).toContain('fecha=2026-08-17');
  });

  it('should_send_an_unready_shop_back_to_the_details_step', async () => {
    create.mockResolvedValue({ outcome: 'notPaymentReady' });

    const response = await POST(request(form()));

    expect(response.headers.get('location')).toContain('estado=sin-pagos');
  });

  it('should_report_the_hold_cap_with_its_own_code', async () => {
    create.mockResolvedValue({ outcome: 'holdLimitReached' });

    const response = await POST(request(form()));

    expect(response.headers.get('location')).toContain('estado=demasiados');
  });

  it('should_send_a_stale_selection_back_to_the_start_of_the_flow', async () => {
    create.mockResolvedValue({ outcome: 'selectionStale' });

    const response = await POST(request(form()));
    const location = response.headers.get('location') ?? '';

    expect(location).toContain(`/b/${SLUG}/reservar`);
    expect(location).not.toContain('local=');
  });

  it('should_reject_a_bad_contact_field_back_to_the_details_step', async () => {
    const response = await POST(request(form({ email: 'not-an-email' })));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('estado=datos');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('POST /api/bookings - what the client typed survives, without reaching a log', () => {
  it('should_carry_the_submitted_values_in_an_httponly_cookie_not_the_url', async () => {
    // A name, an email and a phone in a query string land in browser history,
    // in access logs and in the next request's Referer.
    const response = await POST(request(form({ phone: '555' })));

    const location = response.headers.get('location') ?? '';
    expect(location).not.toContain('ana%40mail.com');
    expect(location).not.toContain('Ana');

    const cookie = response.cookies.get(BOOKING_ECHO_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(decodeURIComponent(cookie?.value ?? '')).toContain('ana@mail.com');
  });

  it('should_scope_the_echo_cookie_to_the_public_flow_and_expire_it', async () => {
    const response = await POST(request(form({ phone: '555' })));
    const cookie = response.cookies.get(BOOKING_ECHO_COOKIE);

    expect(cookie?.path).toBe('/b');
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBeGreaterThan(0);
  });

  it('should_report_every_bad_field_at_once', async () => {
    const response = await POST(request(form({ email: 'nope', phone: '555' })));
    const echo = decodeURIComponent(response.cookies.get(BOOKING_ECHO_COOKIE)?.value ?? '');

    expect(echo).toContain('invalid_email');
    expect(echo).toContain('invalid_phone');
  });
});

describe('POST /api/bookings - failure and abuse', () => {
  it('should_return_a_flow_state_rather_than_reaching_the_error_boundary', async () => {
    // Throwing would replace the page and discard everything the client
    // selected.
    create.mockRejectedValue(new Error('connection reset'));

    const response = await POST(request(form()));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('estado=error');
  });

  it('should_not_log_the_submitted_contact_details_on_an_infrastructure_failure', async () => {
    create.mockRejectedValue(new Error('connection reset'));

    await POST(request(form()));

    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain('ana@mail.com');
    expect(logged).not.toContain('Ana Pérez');
    expect(logged).not.toContain('5555-4444');
  });

  it('should_throttle_a_tight_loop_from_one_origin', async () => {
    const sameOrigin = { 'cf-connecting-ip': '203.0.113.99' };
    let last: Response | undefined;

    for (let i = 0; i < 15; i += 1) {
      last = await POST(
        new Request('https://reserva.test/api/bookings', {
          method: 'POST',
          body: form(),
          headers: sameOrigin,
        }) as never
      );
    }

    expect(last?.status).toBe(429);
  });

  it('should_disclose_nothing_about_the_calendar_in_any_refusal', async () => {
    create.mockResolvedValue({ outcome: 'slotTaken' });

    const response = await POST(request(form()));
    const location = response.headers.get('location') ?? '';

    // The notice the page renders for this code names no barber, no slot and
    // no cause.
    expect(COPY.booking.staleSlot).not.toMatch(/barber|reserv[oó]|ausencia|horario de trabajo/i);
    expect(location).not.toContain('bkg-');
  });

  it('should_refuse_a_submission_with_no_usable_slug', async () => {
    const response = await POST(request(form({ slug: '' })));

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
