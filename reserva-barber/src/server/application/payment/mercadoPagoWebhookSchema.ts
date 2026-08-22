import { z } from 'zod';

/**
 * The Mercado Pago notification, validated before anything reads the database.
 *
 * **This schema's job is to extract an id, not to establish a fact.** Every
 * field here arrives from an unauthenticated public endpoint that anyone can
 * post to, and nothing in the body is trusted: the payment id it yields is
 * handed to Mercado Pago's own API, and *that* answer decides what happens
 * (design D1). A notification is a hint that something may have changed.
 *
 * Bounds run before interpretation, for the same reason the booking request's
 * do: a crafted payload must not turn one request into expensive work.
 */

/** Generous, and far past any real Mercado Pago id. */
const MAX_ID_LENGTH = 64;

/**
 * Mercado Pago sends the id as a string in some payloads and a number in
 * others, and has changed which over time. Accepting both and normalizing to a
 * string is not laxity — it is refusing to make our correctness depend on which
 * of their serializations arrived.
 */
const gatewayId = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0 && value.length <= MAX_ID_LENGTH, {
    message: 'id out of bounds',
  });

/**
 * The two envelopes this endpoint answers to.
 *
 * `type` is the current webhook shape; `topic` is the older IPN one. Both are
 * still delivered depending on how a preference was created and how the
 * integration is configured, so handling one and silently dropping the other
 * would lose confirmations for reasons nobody could see from the code.
 */
const PAYMENT_TOPICS = new Set(['payment']);

const notificationSchema = z.object({
  type: z.string().max(MAX_ID_LENGTH).optional(),
  topic: z.string().max(MAX_ID_LENGTH).optional(),
  action: z.string().max(MAX_ID_LENGTH).optional(),
  data: z.object({ id: gatewayId }).optional(),
  id: gatewayId.optional(),
});

export type MercadoPagoNotification = {
  /** The gateway's payment id, to be verified against the gateway itself. */
  readonly gatewayPaymentId: string;
};

export type NotificationParseResult =
  /** A payment notification carrying a usable id. */
  | { readonly ok: true; readonly notification: MercadoPagoNotification }
  /**
   * Recognized and deliberately not acted on — a merchant-order topic, a
   * heartbeat, a shape we do not handle. **Answered `200`**: asking Mercado
   * Pago to retry a notification we correctly decided to ignore is a
   * self-inflicted load loop.
   */
  | { readonly ok: false; readonly reason: 'ignored' }
  /** Not parseable as a notification at all. */
  | { readonly ok: false; readonly reason: 'malformed' };

/**
 * Reads a notification body, optionally with the query parameters the older
 * IPN form carries them in.
 *
 * The id may arrive as `data.id` (webhook) or as `id` (IPN), and the topic as
 * `type` or `topic`. Both are read rather than one being preferred, because
 * which one arrives is a property of Mercado Pago's configuration rather than
 * of our code.
 */
export function parseMercadoPagoNotification(
  body: unknown,
  query?: URLSearchParams
): NotificationParseResult {
  const merged =
    typeof body === 'object' && body !== null ? { ...(body as Record<string, unknown>) } : {};

  if (query) {
    // Query parameters fill in only what the body did not supply. A body that
    // said something must not be overridden by a URL anyone can craft.
    if (merged.topic === undefined && query.get('topic') !== null) {
      merged.topic = query.get('topic');
    }
    if (merged.type === undefined && query.get('type') !== null) {
      merged.type = query.get('type');
    }
    if (merged.id === undefined && merged.data === undefined && query.get('id') !== null) {
      merged.id = query.get('id');
    }
  }

  const parsed = notificationSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, reason: 'malformed' };
  }

  const { type, topic, data, id } = parsed.data;

  const subject = type ?? topic;
  // A notification about something other than a payment — a merchant order, a
  // plan, a subscription. Recognized, and none of our business.
  if (subject !== undefined && !PAYMENT_TOPICS.has(subject)) {
    return { ok: false, reason: 'ignored' };
  }

  const gatewayPaymentId = data?.id ?? id;
  if (gatewayPaymentId === undefined) {
    // No topic and no id is not a notification we can act on. Ignored rather
    // than malformed: Mercado Pago sends connectivity checks, and answering
    // those with a 4xx would have them retried.
    return { ok: false, reason: subject === undefined ? 'ignored' : 'malformed' };
  }

  return { ok: true, notification: { gatewayPaymentId } };
}
