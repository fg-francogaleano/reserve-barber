import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { BOOKING_OUTCOME_PARAM } from '@/server/application/booking/bookingOutcome';
import { MAX_ATTEMPTS } from '@/server/application/booking/bookingThrottle';

const cancel = vi.fn();

vi.mock('./clientCancellationService', () => ({
  clientCancellationService: () => ({ cancel }),
}));

const TOKEN = 'tok-1';
const SLUG = 'barberia-don-juan';

/**
 * Each request gets its own origin address.
 *
 * `BookingThrottle` is module state and every unattributable request shares one
 * key, so without this the file throttles itself partway through and the later
 * tests measure the limiter instead of the handler.
 */
let caller = 0;

function nextAddress(): string {
  caller += 1;
  return `198.51.100.${caller}`;
}

function request(body: BodyInit, address = nextAddress()) {
  return new NextRequest(new URL('/api/bookings/cancel', 'https://shop.example.com'), {
    method: 'POST',
    headers: { 'cf-connecting-ip': address },
    body,
  });
}

function form(token: string | null = TOKEN): FormData {
  const body = new FormData();
  if (token !== null) body.set('token', token);
  return body;
}

const locationOf = (response: Response) => new URL(response.headers.get('location') ?? '', 'https://shop.example.com');

beforeEach(() => {
  vi.clearAllMocks();
  cancel.mockResolvedValue({ outcome: 'cancelled', slug: SLUG });
});

describe('POST /api/bookings/cancel - the applied path', () => {
  it('should_read_the_token_from_the_body', async () => {
    await POST(request(form()));

    expect(cancel).toHaveBeenCalledWith(TOKEN);
  });

  it('should_send_the_client_back_to_their_own_page_with_303', async () => {
    // `303` rather than `302`: it converts the follow-up into a GET, so a
    // reload or a back-navigation never re-issues the POST.
    const response = await POST(request(form()));

    expect(response.status).toBe(303);
    expect(locationOf(response).pathname).toBe(`/b/${SLUG}/reserva/${TOKEN}`);
  });

  it('should_carry_no_outcome_code_on_success', async () => {
    // The page reads live state and renders the cancelled state on its own. A
    // success code could only agree with the database or be ignored.
    const response = await POST(request(form()));

    expect(locationOf(response).searchParams.get(BOOKING_OUTCOME_PARAM)).toBeNull();
  });

  it('should_use_the_slug_the_service_returned_and_not_one_from_the_body', async () => {
    // The submission carries no slug at all, so there is nothing to trust.
    const body = form();
    body.set('slug', 'otra-barberia');

    const response = await POST(request(body));

    expect(locationOf(response).pathname).toContain(SLUG);
  });
});

describe('POST /api/bookings/cancel - the refusals', () => {
  it('should_report_a_started_appointment_with_its_own_code', async () => {
    cancel.mockResolvedValue({ outcome: 'notCancellable', slug: SLUG, reason: 'alreadyStarted' });

    const response = await POST(request(form()));

    expect(response.status).toBe(303);
    expect(locationOf(response).searchParams.get(BOOKING_OUTCOME_PARAM)).toBe('turno-empezado');
  });

  it('should_report_a_booking_that_moved_with_the_generic_code', async () => {
    cancel.mockResolvedValue({
      outcome: 'notCancellable',
      slug: SLUG,
      reason: 'noLongerCancellable',
    });

    const response = await POST(request(form()));

    expect(locationOf(response).searchParams.get(BOOKING_OUTCOME_PARAM)).toBe(
      'cancelacion-no-posible'
    );
  });

  it('should_still_return_the_client_to_their_page_on_a_refusal', async () => {
    cancel.mockResolvedValue({
      outcome: 'notCancellable',
      slug: SLUG,
      reason: 'noLongerCancellable',
    });

    const response = await POST(request(form()));

    expect(locationOf(response).pathname).toBe(`/b/${SLUG}/reserva/${TOKEN}`);
  });
});

describe('POST /api/bookings/cancel - what it refuses to disclose', () => {
  it('should_answer_404_for_a_token_matching_nothing', async () => {
    cancel.mockResolvedValue({ outcome: 'notFound' });

    const response = await POST(request(form('forged')));

    expect(response.status).toBe(404);
  });

  it('should_not_redirect_a_token_that_matched_nothing', async () => {
    // There is no slug to redirect to, and inventing one would disclose whether
    // the token resolved.
    cancel.mockResolvedValue({ outcome: 'notFound' });

    const response = await POST(request(form('forged')));

    expect(response.headers.get('location')).toBeNull();
  });

  it('should_not_name_the_shop_in_the_body_of_a_404', async () => {
    cancel.mockResolvedValue({ outcome: 'notFound' });

    const response = await POST(request(form('forged')));

    expect(await response.text()).not.toContain(SLUG);
  });
});

describe('POST /api/bookings/cancel - malformed submissions', () => {
  it('should_answer_400_when_no_token_is_supplied', async () => {
    const response = await POST(request(form(null)));

    expect(response.status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('should_answer_400_for_an_empty_token', async () => {
    const response = await POST(request(form('')));

    expect(response.status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('should_answer_400_for_an_oversized_token', async () => {
    const response = await POST(request(form('t'.repeat(129))));

    expect(response.status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('should_answer_400_for_a_body_that_is_not_a_form', async () => {
    const response = await POST(
      new NextRequest(new URL('/api/bookings/cancel', 'https://shop.example.com'), {
        method: 'POST',
        headers: { 'cf-connecting-ip': nextAddress(), 'content-type': 'application/json' },
        body: '{"token":"tok-1"}',
      })
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /api/bookings/cancel - the throttle', () => {
  it('should_answer_429_once_one_origin_goes_past_the_bound', async () => {
    const address = nextAddress();

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await POST(request(form(), address));
    }
    const response = await POST(request(form(), address));

    expect(response.status).toBe(429);
  });

  it('should_not_throttle_a_different_origin', async () => {
    const address = nextAddress();
    for (let i = 0; i <= MAX_ATTEMPTS; i += 1) {
      await POST(request(form(), address));
    }

    const response = await POST(request(form(), nextAddress()));

    expect(response.status).toBe(303);
  });
});

describe('POST /api/bookings/cancel - failure', () => {
  it('should_answer_500_and_never_rethrow', async () => {
    // Rethrowing would reach a route error boundary, replace the page and lose
    // the client's only way back to their booking.
    cancel.mockRejectedValue(new Error('database unreachable'));

    const response = await POST(request(form()));

    expect(response.status).toBe(500);
  });

  it('should_not_leak_the_failure_text', async () => {
    cancel.mockRejectedValue(new Error('connection to db-prod-1 refused'));

    const response = await POST(request(form()));

    expect(await response.text()).not.toContain('db-prod-1');
  });
});

/**
 * Found by the adversarial pass, not by the specification.
 *
 * `formData()` buffers whatever arrives into an isolate with a hard memory
 * bound, and nothing else on this route limits it. The transfer endpoint
 * guards its own body for exactly this reason; that this one carries no file
 * makes the bound smaller, not unnecessary.
 */
describe('POST /api/bookings/cancel - the body ceiling', () => {
  it('should_refuse_a_body_that_declares_itself_large', async () => {
    const request = new NextRequest(new URL('/api/bookings/cancel', 'https://shop.example.com'), {
      method: 'POST',
      headers: { 'cf-connecting-ip': nextAddress(), 'content-length': String(9 * 1024) },
      body: form(),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
  });

  it('should_refuse_it_before_the_service_is_reached', async () => {
    const request = new NextRequest(new URL('/api/bookings/cancel', 'https://shop.example.com'), {
      method: 'POST',
      headers: { 'cf-connecting-ip': nextAddress(), 'content-length': String(1024 * 1024) },
      body: form(),
    });

    await POST(request);

    expect(cancel).not.toHaveBeenCalled();
  });

  it('should_admit_an_ordinary_submission', async () => {
    // The real body is one token in a form field.
    const response = await POST(request(form()));

    expect(response.status).toBe(303);
  });
});
