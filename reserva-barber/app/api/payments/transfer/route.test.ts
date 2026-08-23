import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { BOOKING_OUTCOME_PARAM } from '@/server/application/booking/bookingOutcome';
import { MAX_RECEIPT_BYTES } from '@/server/domain/models/receiptFileType';

const commit = vi.fn();
const submitReceipt = vi.fn();

vi.mock('./transferPaymentService', () => ({
  transferPaymentService: () => ({ commit, submitReceipt }),
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
  return `203.0.113.${caller}`;
}

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest(new URL('/api/payments/transfer', 'https://shop.example.com'), {
    method: 'POST',
    headers: { 'cf-connecting-ip': nextAddress(), ...headers },
    body,
  });
}

function commitBody(token = TOKEN): FormData {
  const form = new FormData();
  form.set('token', token);
  return form;
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function receiptBody(
  bytes: Uint8Array = PDF_BYTES,
  filename = 'comprobante.pdf',
  type = 'application/pdf'
): FormData {
  const form = new FormData();
  form.set('token', TOKEN);
  form.set('receipt', new File([bytes as BlobPart], filename, { type }));
  return form;
}

function outcomeOf(response: Response): string | null {
  const location = response.headers.get('location');
  return location === null ? null : new URL(location).searchParams.get(BOOKING_OUTCOME_PARAM);
}

beforeEach(() => {
  commit.mockReset();
  submitReceipt.mockReset();
  commit.mockResolvedValue({ outcome: 'committed', slug: SLUG });
  submitReceipt.mockResolvedValue({ outcome: 'received', slug: SLUG });
});

describe('the two intents share one path', () => {
  it('treats a body without a file as a commitment', async () => {
    await POST(request(commitBody()));

    expect(commit).toHaveBeenCalledWith(TOKEN);
    expect(submitReceipt).not.toHaveBeenCalled();
  });

  it('treats a body carrying a file as a receipt submission', async () => {
    await POST(request(receiptBody()));

    expect(submitReceipt).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('the token travels in the body', () => {
  it('refuses a submission with no token', async () => {
    const form = new FormData();

    const response = await POST(request(form));

    expect(response.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  // Generous, like every other bound on a stranger-supplied value in this flow.
  it('refuses an overlong token before doing any work', async () => {
    const response = await POST(request(commitBody('x'.repeat(129))));

    expect(response.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('never puts the token in the redirect path of an error response', async () => {
    commit.mockResolvedValue({ outcome: 'notFound' });

    const response = await POST(request(commitBody()));

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('the size ceiling is enforced before the body is read', () => {
  /**
   * A multipart body is buffered into an isolate with a hard memory bound, so
   * this check is a memory guard rather than a formality. It is the only one
   * that runs while the request is still cheap to refuse.
   */
  it('refuses on Content-Length without parsing the body', async () => {
    const response = await POST(
      request(commitBody(), { 'content-length': String(MAX_RECEIPT_BYTES * 2) })
    );

    expect(response.status).toBe(413);
    expect(commit).not.toHaveBeenCalled();
    expect(submitReceipt).not.toHaveBeenCalled();
  });

  // The header is client-controlled: a request can declare itself small and
  // deliver otherwise, so the real length is measured too.
  it('refuses an oversized file whose declared length was small', async () => {
    const oversized = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    oversized.set(PDF_BYTES, 0);

    const response = await POST(request(receiptBody(oversized)));

    expect(response.status).toBe(413);
    expect(submitReceipt).not.toHaveBeenCalled();
  });
});

describe('nothing the client names reaches the service', () => {
  /**
   * The filename is client-controlled and is a traversal primitive if it ever
   * reaches a storage key, and the declared type proves nothing about the
   * bytes. Neither is forwarded — the service receives bytes and a token.
   */
  it('forwards only the token and the bytes', async () => {
    await POST(request(receiptBody(PDF_BYTES, '../../other-owner/x.jpg', 'image/jpeg')));

    expect(submitReceipt).toHaveBeenCalledWith({
      cancellationToken: TOKEN,
      bytes: expect.any(Uint8Array),
    });
    const [call] = submitReceipt.mock.calls;
    expect(Object.keys(call[0])).toEqual(['cancellationToken', 'bytes']);
  });
});

describe('each outcome renders as its own code', () => {
  it.each([
    ['committed', 'transferencia-iniciada'],
    // A double-tap must be invisible to the person who made it: the same
    // ending, so the same code and the same rendered page.
    ['alreadyCommitted', 'transferencia-iniciada'],
    ['notPayable', 'no-pagable'],
    ['holdExpired', 'vencido'],
    ['notConfigured', 'sin-transferencia'],
    ['metodoEnCurso', 'metodo-en-curso'],
  ])('maps the commit outcome %s', async (outcome, code) => {
    commit.mockResolvedValue({
      outcome: outcome === 'metodoEnCurso' ? 'mercadoPagoInFlight' : outcome,
      slug: SLUG,
    });

    const response = await POST(request(commitBody()));

    expect(response.status).toBe(303);
    expect(outcomeOf(response)).toBe(code);
  });

  it.each([
    ['received', 'comprobante-recibido'],
    ['invalidFile', 'comprobante-invalido'],
    ['fileTooLarge', 'comprobante-grande'],
    ['tooManyAttempts', 'demasiados-comprobantes'],
    ['slotLost', 'transferencia-sin-lugar'],
    ['notPayable', 'no-pagable'],
    ['notCommitted', 'no-pagable'],
  ])('maps the submission outcome %s', async (outcome, code) => {
    submitReceipt.mockResolvedValue({ outcome, slug: SLUG });

    const response = await POST(request(receiptBody()));

    expect(response.status).toBe(303);
    expect(outcomeOf(response)).toBe(code);
  });

  /**
   * Distinguishable causes, because each has a different next move. A single
   * message would tell a client with a 12 MB PDF and a client with a HEIC photo
   * the same useless thing.
   */
  it('gives the two file refusals different codes', async () => {
    submitReceipt.mockResolvedValue({ outcome: 'invalidFile', slug: SLUG });
    const invalid = outcomeOf(await POST(request(receiptBody())));

    submitReceipt.mockResolvedValue({ outcome: 'fileTooLarge', slug: SLUG });
    const large = outcomeOf(await POST(request(receiptBody())));

    expect(invalid).not.toBe(large);
  });
});

describe('the redirect is a 303', () => {
  /**
   * `303` converts the follow-up into a `GET`, so a reload or a
   * back-navigation never re-issues the `POST` — which on this endpoint would
   * mean re-uploading the file and consuming another of the three attempts.
   */
  it('sends the browser back with a GET', async () => {
    const response = await POST(request(receiptBody()));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(`/b/${SLUG}/reserva/${TOKEN}`);
  });
});

describe('unresolvable tokens disclose nothing', () => {
  /**
   * A token that never existed and one belonging to another shop's booking must
   * be answered identically — B1 and B2 established that a differential answer
   * is an existence oracle on a route with no rate limit.
   */
  it('answers a commitment and a submission for an unknown token the same way', async () => {
    commit.mockResolvedValue({ outcome: 'notFound' });
    submitReceipt.mockResolvedValue({ outcome: 'notFound' });

    const one = await POST(request(commitBody()));
    const two = await POST(request(receiptBody()));

    expect(one.status).toBe(404);
    expect(two.status).toBe(404);
    expect(await one.text()).toEqual(await two.text());
  });
});

describe('an unexpected failure never escapes into the error boundary', () => {
  /**
   * Rethrowing would replace the page and lose the client's way back to their
   * own booking. The context carries an operation and an error name — never the
   * token, never a filename, never a destination.
   */
  it('answers 500 rather than throwing', async () => {
    submitReceipt.mockRejectedValue(new Error('storage unreachable'));

    const response = await POST(request(receiptBody()));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('storage unreachable');
    expect(body).not.toContain(TOKEN);
  });
});

describe('the throttle', () => {
  it('refuses a burst from one address', async () => {
    const address = nextAddress();
    const responses: Response[] = [];

    for (let i = 0; i < 12; i += 1) {
      const form = new FormData();
      form.set('token', TOKEN);
      responses.push(
        await POST(
          new NextRequest(new URL('/api/payments/transfer', 'https://shop.example.com'), {
            method: 'POST',
            headers: { 'cf-connecting-ip': address },
            body: form,
          })
        )
      );
    }

    expect(responses.some((response) => response.status === 429)).toBe(true);
  });
});
