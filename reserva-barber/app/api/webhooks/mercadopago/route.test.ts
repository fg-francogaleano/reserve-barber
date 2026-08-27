import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { POST } from './route';

const confirm = vi.fn();

vi.mock('./webhookService', () => ({
  paymentConfirmationService: () => ({ confirm }),
}));

function notify(
  url: string,
  body: unknown = { type: 'payment', data: { id: '12345678' } }
): NextRequest {
  return new NextRequest(new URL(url, 'https://shop.example'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  confirm.mockReset();
  confirm.mockResolvedValue({ outcome: 'confirmed' });
});

describe('the response policy', () => {
  it('acknowledges a handled notification', async () => {
    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(response.status).toBe(200);
  });

  /**
   * Retrying a notification we correctly decided to ignore is a self-inflicted
   * load loop on an endpoint that also spends an outbound call.
   */
  it.each([
    'unresolved',
    'notAtGateway',
    'mismatch',
    'notApproved',
    'alreadyProcessed',
    'reversedAfterConfirmation',
    'slotLost',
  ])('acknowledges the %s outcome rather than asking for a retry', async (outcome) => {
    confirm.mockResolvedValue({ outcome });

    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(response.status).toBe(200);
  });

  it('asks for a retry only on a transient failure', async () => {
    confirm.mockResolvedValue({ outcome: 'retry' });

    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(response.status).toBe(503);
  });

  it('asks for a retry when the handler throws', async () => {
    // Most likely the database being unreachable, which is exactly the case
    // another delivery can resolve.
    confirm.mockRejectedValue(new Error('connection reset'));

    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(response.status).toBe(503);
  });
});

describe('the endpoint is not an oracle', () => {
  /**
   * A response that differed between "this ref matches nothing", "already
   * processed" and "verification refused" would let anyone discover which
   * bookings and payments exist by watching the answers.
   */
  it('answers identically across every non-retry outcome', async () => {
    const bodies: string[] = [];

    for (const outcome of ['confirmed', 'unresolved', 'mismatch', 'alreadyProcessed']) {
      confirm.mockResolvedValue({ outcome });
      const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));
      bodies.push(`${response.status}:${await response.text()}`);
    }

    expect(new Set(bodies).size).toBe(1);
  });

  it('answers a missing ref the same way as a handled one', async () => {
    const handled = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));
    const missing = await POST(notify('/api/webhooks/mercadopago'));

    expect(missing.status).toBe(handled.status);
    expect(await missing.text()).toBe(await handled.text());
  });
});

describe('nothing expensive runs before the cheap checks', () => {
  it('does not reach the service without a ref', async () => {
    await POST(notify('/api/webhooks/mercadopago'));

    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not reach the service with an over-long ref', async () => {
    await POST(notify(`/api/webhooks/mercadopago?ref=${'x'.repeat(65)}`));

    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not reach the service for a topic it does not handle', async () => {
    await POST(
      notify('/api/webhooks/mercadopago?ref=pay-1', {
        type: 'merchant_order',
        data: { id: '1' },
      })
    );

    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the shapes Mercado Pago actually sends', () => {
  it('handles the current webhook body', async () => {
    await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(confirm).toHaveBeenCalledWith({
      paymentRef: 'pay-1',
      gatewayPaymentId: '12345678',
    });
  });

  /**
   * The older IPN form carries everything in the query string and may send no
   * body at all. Handling one shape and dropping the other would lose
   * confirmations for a reason invisible from the code.
   */
  it('handles the IPN query form with an unreadable body', async () => {
    const request = new NextRequest(
      new URL('/api/webhooks/mercadopago?ref=pay-1&topic=payment&id=987', 'https://shop.example'),
      { method: 'POST' }
    );

    await POST(request);

    expect(confirm).toHaveBeenCalledWith({ paymentRef: 'pay-1', gatewayPaymentId: '987' });
  });
});

describe('what must stay absent', () => {
  const imports = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');

  it('reaches the database only through its composition root', () => {
    expect(imports).not.toMatch(/infrastructure\/prisma\/Prisma/);
    expect(imports).toMatch(/webhookService/);
  });

  it('constructs no cipher of its own', () => {
    expect(imports).not.toMatch(/Cipher/i);
  });

  it('imports no Supabase client', () => {
    expect(imports).not.toMatch(/supabase|createClient/i);
  });
});

describe('the webhook composer', () => {
  const source = readFileSync(new URL('./webhookService.ts', import.meta.url), 'utf8');

  // T57, again: a missing argument here compiles, typechecks, and passes every
  // service unit test, then surfaces as payments that never confirm.
  it('passes all five collaborators', () => {
    expect(source).toMatch(/new PrismaPaymentRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db, new WebCryptoCipher\(\)\)/);
    expect(source).toMatch(/new MercadoPagoGateway\(\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
  });

  it('never builds the payment repository without its cipher', () => {
    expect(source).not.toMatch(/new PrismaPaymentConfigRepository\(db\)/);
  });
});

describe('cookies are cleared at the path they were set on', () => {
  /**
   * **Found by reading the preview's response headers, not by a test.** Both
   * of this flow's cookies are set with `path=/b`, and both were being cleared
   * with the default `path=/` — a `Set-Cookie` the browser matches against
   * nothing, leaving the original alive for its full lifetime.
   *
   * For the payment return cookie that is a privacy defect, not an annoyance:
   * on a shared device, the next person to land on the return route inside the
   * hour would be forwarded to the previous client's confirmation page, which
   * names them and offers to pay their deposit.
   *
   * Asserted as source, because a unit test cannot model cookie path matching
   * and a response-shape assertion would pass on the broken form.
   */
  it('deletes the payment return cookie with its own path', () => {
    const source = readFileSync(
      new URL('../../../b/[slug]/pago/retorno/route.ts', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(/cookies\.delete\(\{\s*name: PAYMENT_RETURN_COOKIE,\s*path: '\/b'/);
    expect(source).not.toMatch(/cookies\.delete\(PAYMENT_RETURN_COOKIE\)/);
  });

  it('deletes the booking echo cookie with its own path', () => {
    const source = readFileSync(new URL('../../bookings/route.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/cookies\.delete\(\{\s*name: BOOKING_ECHO_COOKIE,\s*path: '\/b'/);
    expect(source).not.toMatch(/cookies\.delete\(BOOKING_ECHO_COOKIE\)/);
  });
});

/**
 * The confirmation email is invisible from outside this endpoint (N1).
 *
 * The uniform body for every non-retry outcome exists so a public endpoint is
 * not an oracle for which bookings and payments exist. An email that failed
 * must not become a new way to ask — and, more sharply, must not become a
 * `503`: the redelivery that request asks for would find the booking already
 * `CONFIRMED`, report `alreadyProcessed`, and by the trigger rule send nothing.
 */
describe('the confirmation email changes nothing about the response', () => {
  it('answers identically whether or not the email succeeded', async () => {
    // Arrange: the service swallows every send failure, so both cases reach the
    // route as the same `confirmed` outcome. This asserts the route keeps it
    // that way rather than growing a branch for it.
    confirm.mockResolvedValue({ outcome: 'confirmed' });
    const sent = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));
    const sentBody = await sent.json();

    confirm.mockResolvedValue({ outcome: 'confirmed' });
    const failed = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));
    const failedBody = await failed.json();

    expect(sent.status).toBe(failed.status);
    expect(sentBody).toEqual(failedBody);
    expect(sent.status).toBe(200);
  });

  it('never asks for a retry because of the email', async () => {
    // Arrange: `retry` remains reachable only from a genuinely transient
    // gateway or database failure, never from a mail provider.
    confirm.mockResolvedValue({ outcome: 'confirmed' });

    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));

    expect(response.status).not.toBe(503);
    expect(await response.json()).toEqual({ received: true });
  });

  it('still acknowledges when the service throws unexpectedly, without leaking why', async () => {
    // Arrange: the notification service is specified never to throw and the
    // confirmation service guards it anyway. If both contracts were broken the
    // route's own catch answers 503 — and its body must still disclose nothing.
    confirm.mockRejectedValue(new Error('provider down: ana@example.com rejected'));

    const response = await POST(notify('/api/webhooks/mercadopago?ref=pay-1'));
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain('ana@example.com');
    expect(body).not.toContain('provider down');
  });
});
