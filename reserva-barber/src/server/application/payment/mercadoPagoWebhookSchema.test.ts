import { describe, it, expect } from 'vitest';
import { parseMercadoPagoNotification } from './mercadoPagoWebhookSchema';

describe('the webhook envelope', () => {
  it('reads the current webhook shape', () => {
    const result = parseMercadoPagoNotification({
      action: 'payment.updated',
      type: 'payment',
      data: { id: '12345678' },
    });

    expect(result).toEqual({ ok: true, notification: { gatewayPaymentId: '12345678' } });
  });

  /**
   * The older IPN form is still delivered depending on how the integration is
   * configured. Handling one shape and silently dropping the other would lose
   * confirmations for a reason invisible from the code.
   */
  it('reads the older IPN shape from query parameters', () => {
    const result = parseMercadoPagoNotification(
      {},
      new URLSearchParams('topic=payment&id=12345678')
    );

    expect(result).toEqual({ ok: true, notification: { gatewayPaymentId: '12345678' } });
  });

  /**
   * Mercado Pago has sent the id as both a string and a number. Normalizing
   * both is not laxity: it refuses to make our correctness depend on which of
   * their serializations happened to arrive.
   */
  it('accepts a numeric id and normalizes it', () => {
    const result = parseMercadoPagoNotification({ type: 'payment', data: { id: 12345678 } });

    expect(result).toEqual({ ok: true, notification: { gatewayPaymentId: '12345678' } });
  });

  it('does not let a query parameter override a body that spoke', () => {
    const result = parseMercadoPagoNotification(
      { type: 'payment', data: { id: 'real' } },
      new URLSearchParams('topic=payment&id=forged')
    );

    expect(result).toEqual({ ok: true, notification: { gatewayPaymentId: 'real' } });
  });
});

describe('what is recognized and not acted on', () => {
  /**
   * Answered `200` by the caller. Asking Mercado Pago to retry a notification
   * we correctly decided to ignore is a self-inflicted load loop on an endpoint
   * that also spends an outbound call.
   */
  it.each(['merchant_order', 'plan', 'subscription', 'invoice', 'point_integration_wh'])(
    'ignores the %s topic',
    (topic) => {
      const result = parseMercadoPagoNotification({ type: topic, data: { id: '1' } });

      expect(result).toEqual({ ok: false, reason: 'ignored' });
    }
  );

  it('ignores a body with neither a topic nor an id', () => {
    // Mercado Pago sends connectivity checks. Answering those with a 4xx would
    // have them retried.
    expect(parseMercadoPagoNotification({})).toEqual({ ok: false, reason: 'ignored' });
  });

  it('treats a payment topic with no id as malformed', () => {
    expect(parseMercadoPagoNotification({ type: 'payment' })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('bounds run before interpretation', () => {
  it('refuses an id past the length bound', () => {
    const result = parseMercadoPagoNotification({
      type: 'payment',
      data: { id: 'x'.repeat(65) },
    });

    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses an empty id', () => {
    expect(parseMercadoPagoNotification({ type: 'payment', data: { id: '' } })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses a topic past the length bound', () => {
    const result = parseMercadoPagoNotification({
      type: 'p'.repeat(65),
      data: { id: '1' },
    });

    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([null, 'a string', 42, []])('survives a body that is %s', (body) => {
    const result = parseMercadoPagoNotification(body);

    expect(result.ok).toBe(false);
  });

  it('refuses an id that is neither a string nor a number', () => {
    const result = parseMercadoPagoNotification({ type: 'payment', data: { id: { a: 1 } } });

    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});
