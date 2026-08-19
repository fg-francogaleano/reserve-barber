/**
 * The two Mercado Pago calls this product makes, as a contract the domain owns.
 *
 * **Nothing about Mercado Pago's wire format appears here.** Their payload
 * shapes, their error envelopes and their URL structure live in the
 * infrastructure adapter; what crosses this boundary is the small set of facts
 * a decision depends on. That is what lets the confirmation service be tested
 * without a network and reviewed without knowing their API.
 *
 * **The access token is a parameter, never a constructor field.** The adapter
 * is built once and serves whichever owner the request concerns, so a token
 * held on the instance would be a credential outliving the request that needed
 * it — and the one thing this flow must not do is let a decrypted token sit
 * anywhere longer than a single call (B5 design D4).
 */

import type { GatewayPayment } from '../models/Payment';

/**
 * Everything the preference needs, assembled by the application layer from the
 * booking row alone.
 *
 * There is no field here a client can influence. The amount is the booking's
 * snapshot, the reference is the booking's id, and the two URLs are built from
 * the request's own origin.
 */
export interface PreferenceInput {
  /** Shown on Mercado Pago's checkout. The service name, never the client's. */
  readonly title: string;
  /** The booking's snapshotted deposit, as a canonical decimal string. */
  readonly amount: string;
  /**
   * The booking's id — **never the cancellation token** (design D3). This value
   * is stored by Mercado Pago, shown in their dashboard and echoed back in
   * every notification; the token is the client's cancellation credential and
   * cannot be rotated without invalidating the link they hold.
   */
  readonly externalReference: string;
  /** Absolute, and carrying `?ref={payment.id}` so the owner is resolvable. */
  readonly notificationUrl: string;
  /** Where the client lands afterwards. Proves nothing; see design D10. */
  readonly backUrl: string;
  /**
   * When Mercado Pago should stop accepting this checkout — the booking's
   * `holdExpiresAt`. The first of the three layers against a late payment: it
   * fails at the gateway rather than in our data, though it narrows the race
   * rather than closing it.
   */
  readonly expiresAt: Date;
}

/**
 * What creating a preference produced.
 *
 * `invalid` is separated from `rejected` because they mean opposite things
 * about the owner's configuration: `invalid` is Mercado Pago refusing *this
 * charge* (an amount below their minimum is the case B5 exists to discover),
 * while `rejected` is Mercado Pago refusing *this credential*. Collapsing them
 * would tell an owner their token is broken when their deposit is simply too
 * small.
 *
 * `unavailable` never blames anyone: unreachable, slow, or failing in a way
 * that says nothing about whether a retry would work.
 */
export type PreferenceResult =
  | {
      readonly status: 'created';
      readonly preferenceId: string;
      /** Where to send the client. Stored on the payment, not reconstructed. */
      readonly initPoint: string;
    }
  | { readonly status: 'invalid' }
  | { readonly status: 'rejected' }
  | { readonly status: 'unavailable' };

/**
 * What asking Mercado Pago about a payment produced.
 *
 * `notFound` is its own outcome and is **terminal, not transient**. A
 * notification naming a payment the owner's own account does not have is the
 * shape a forged notification takes, and answering it as an outage would ask
 * Mercado Pago to retry something that will never resolve.
 */
export type GatewayPaymentResult =
  | { readonly status: 'found'; readonly payment: GatewayPayment }
  | { readonly status: 'notFound' }
  | { readonly status: 'rejected' }
  | { readonly status: 'unavailable' };

export interface IPaymentGateway {
  /**
   * Creates the checkout the client is redirected to.
   *
   * MUST be bounded by a timeout. Without one, an unresponsive Mercado Pago
   * leaves the request pending until the platform kills it, the client submits
   * again, and two preferences race — which is exactly the double-charge the
   * live-payment bound exists to prevent, arriving through the gateway instead
   * of through the database.
   */
  createPreference(input: PreferenceInput, accessToken: string): Promise<PreferenceResult>;

  /**
   * Asks Mercado Pago what actually happened to a payment.
   *
   * **This is the authority the webhook rests on** (design D1). The
   * notification body is a hint; this answer decides. An attacker can post any
   * payload to a public URL, but cannot make the owner's own Mercado Pago
   * account confirm a payment that does not exist.
   *
   * MUST be bounded by a timeout, and MUST NOT be called inside a database
   * transaction — a third party's latency must never hold a pooled connection.
   */
  getPayment(gatewayPaymentId: string, accessToken: string): Promise<GatewayPaymentResult>;
}
