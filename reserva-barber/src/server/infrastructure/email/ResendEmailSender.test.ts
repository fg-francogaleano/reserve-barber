import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResendEmailSender, RESEND_URL, EMAIL_TIMEOUT_MS } from './ResendEmailSender';
import type { EmailMessage } from '@/server/domain/repositories/IEmailSender';

const API_KEY = 're_test_key_do_not_log';
const FROM = 'Barbería Central <turnos@barberia.example>';

const MESSAGE: EmailMessage = {
  to: 'ana@example.com',
  subject: 'Tu turno en Barbería Central — domingo, 30 de agosto · 15:30',
  text: 'Hola Ana,\nhttps://reserva.example.com/b/x/reserva/tok-abc123',
  html: '<p>Hola Ana</p>',
};

function respondWith(status: number, body: unknown = {}): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as unknown as typeof fetch;
}

describe('ResendEmailSender - outcome mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_report_sent_when_the_provider_accepts', async () => {
    // Arrange
    const transport = respondWith(200, { id: 'msg-1' });
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('sent');
  });

  it('should_report_rejected_for_an_unprocessable_request', async () => {
    // Arrange: a wrong request stays wrong, so another attempt buys nothing.
    const transport = respondWith(422, { message: 'Invalid `to` field' });
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('rejected');
  });

  it('should_report_rejected_for_a_refused_credential', async () => {
    // Arrange
    const transport = respondWith(401, { message: 'API key is invalid' });
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('rejected');
  });

  it('should_report_throttled_when_rate_limited_or_over_quota', async () => {
    // Arrange: distinct from rejected, because it means the shop has stopped
    // notifying its clients while everything else still works.
    const transport = respondWith(429, { message: 'Too many requests' });
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('throttled');
  });

  it('should_report_retry_for_a_provider_server_error', async () => {
    // Arrange
    const transport = respondWith(503, {});
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('retry');
  });

  it('should_report_retry_when_the_transport_itself_fails', async () => {
    // Arrange
    const transport = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('retry');
  });

  it('should_report_retry_when_the_call_is_aborted_by_its_timeout', async () => {
    // Arrange
    const transport = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'TimeoutError');
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('retry');
  });

  it('should_never_throw_whatever_the_provider_does', async () => {
    // Arrange: the contract the notification path depends on. A throw here
    // becomes a 503 and asks Mercado Pago to redeliver a confirmation that
    // already succeeded.
    const transport = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act & Assert
    await expect(sender.send(MESSAGE)).resolves.toEqual({ outcome: 'retry' });
  });
});

describe('ResendEmailSender - the transport contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_carry_the_key_in_a_header_and_never_in_the_url', async () => {
    // Arrange
    const transport = respondWith(200);
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    await sender.send(MESSAGE);

    // Assert
    const [url, init] = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe(RESEND_URL);
    expect(String(url)).not.toContain(API_KEY);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('should_bound_the_call_with_an_abort_signal', async () => {
    // Arrange: an unbounded call leaves a request pending until the platform
    // kills it.
    const transport = respondWith(200);
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    await sender.send(MESSAGE);

    // Assert
    const [, init] = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(EMAIL_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it('should_send_both_parts_and_the_configured_sender', async () => {
    // Arrange
    const transport = respondWith(200);
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    await sender.send(MESSAGE);

    // Assert
    const [, init] = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.from).toBe(FROM);
    expect(body.to).toEqual([MESSAGE.to]);
    expect(body.subject).toBe(MESSAGE.subject);
    expect(body.text).toBe(MESSAGE.text);
    expect(body.html).toBe(MESSAGE.html);
  });

  it('should_post_to_exactly_one_documented_endpoint', async () => {
    // Arrange
    const transport = respondWith(200);
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    await sender.send(MESSAGE);

    // Assert
    const [url, init] = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).method).toBe('POST');
  });
});

describe('ResendEmailSender - what must never escape the adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_not_attach_the_provider_response_body_to_the_result', async () => {
    // Arrange: a 422 from this provider echoes the submitted fields — which
    // here are the recipient's address and the cancellation link. A body that
    // escapes this file is a leaked credential.
    const echo = {
      message: 'Invalid request',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    };
    const transport = respondWith(422, echo);
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(result).toEqual({ outcome: 'rejected' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('tok-abc123');
    expect(serialized).not.toContain('Invalid request');
  });

  it('should_not_attach_a_thrown_error_to_the_result', async () => {
    // Arrange: a thrown transport error can quote the request, headers included.
    const transport = vi.fn(async () => {
      throw new Error(`failed to POST with Authorization: Bearer ${API_KEY}`);
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(result).toEqual({ outcome: 'retry' });
  });

  it('should_expose_only_the_outcome_field', async () => {
    // Arrange: the shape is the guarantee. A second field is a place a body,
    // an address or a token can later be added without anyone noticing.
    const transport = respondWith(200, { id: 'msg-1' });
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    const result = await sender.send(MESSAGE);

    // Assert
    expect(Object.keys(result)).toEqual(['outcome']);
  });

  it('should_not_read_the_response_body_at_all', async () => {
    // Arrange: nothing in the result depends on it, and not reading it is the
    // structural form of "no body escapes this file".
    const json = vi.fn();
    const text = vi.fn();
    const transport = vi.fn(async () => ({ ok: true, status: 200, json, text })) as unknown as typeof fetch;
    const sender = new ResendEmailSender(API_KEY, FROM, transport);

    // Act
    await sender.send(MESSAGE);

    // Assert
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });
});
