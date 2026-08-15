/**
 * The owner's shared payment configuration (docs/data-model.md §14).
 *
 * One row per owner, written by three separate stories: PC1 the transfer
 * destination, PC2 the Mercado Pago credentials, PC3 the deposit policy. The
 * types below keep those concerns separable so a partial write cannot be
 * expressed as a whole-entity write (design D5).
 */

export type DepositType = 'FIXED' | 'PERCENT';

/**
 * The transfer destination as clients see it — and the ONLY shape allowed to
 * cross into the public booking flow (design D7).
 *
 * `mpAccessToken` lives in the same database row. A type that cannot carry it
 * cannot leak it through a serialized prop, a logged object or an error
 * payload, which is a stronger guarantee than every consumer remembering to
 * strip it.
 */
export type TransferDetails = {
  cbuCvu: string | null;
  alias: string | null;
  holderName: string | null;
};

/** The three transfer columns as written. Never widened to the whole entity. */
export type TransferDetailsInput = TransferDetails;

/**
 * The deposit policy as written and as read (PC3).
 *
 * `value` is null exactly while the policy is unconfigured. `type` is never
 * null — the column carries a default so that a write belonging to another
 * story can create the row without choosing a policy — which is why the
 * configured/unconfigured question is asked of `value` alone.
 */
export type DepositPolicySettings = {
  type: DepositType;
  value: string | null;
};

/** The two deposit columns as written. Never widened to the whole entity. */
export type DepositPolicyInput = {
  type: DepositType;
  value: string;
};

/**
 * Whether the business can accept bookings, and what is missing when it cannot.
 *
 * Reported by the deposit editor (PC3) and enforced at the entry to the booking
 * flow (B4). The two are deliberately different surfaces: a dashboard that
 * refuses to save is not the same control as a booking flow that refuses to
 * book, and only the second one protects a client.
 */
export type PaymentReadiness = {
  ready: boolean;
  hasPaymentMethod: boolean;
  hasDepositPolicy: boolean;
};

/**
 * The full configuration, for the dashboard only.
 *
 * `depositValue` is nullable because the row is created by whichever payment
 * story the owner completes first, and no deposit policy exists until PC3. The
 * guarantee that a business can accept bookings is therefore an application
 * gate, not a column constraint — `isBookable` at the foot of this file.
 */
export type PaymentConfig = {
  id: string;
  ownerId: string;
  mpPublicKey: string | null;
  hasMercadoPagoCredentials: boolean;
  transfer: TransferDetails;
  depositType: DepositType;
  depositValue: string | null;
  /**
   * When any part of the configuration last changed (PC2).
   *
   * Carried because the access token is never displayed: after a save whose
   * outcome was uncertain, a presence flag alone cannot tell the owner whether
   * the new token or the old one is stored. This and the token's last four
   * answer that without disclosing anything.
   */
  updatedAt: Date;
};

/**
 * The Mercado Pago credential pair, as written (PC2).
 *
 * Both fields or neither — `data-model.md` §14. A public key alone cannot
 * authorize a charge and an access token alone cannot initialize the
 * client-side checkout, so half a pair is a payment method that fails at the
 * moment a client tries to use it. `null` on both is the configured-off state.
 */
export type MercadoPagoCredentials = {
  accessToken: string | null;
  publicKey: string | null;
};

/**
 * Everything the dashboard may know about the stored credentials — and the ONLY
 * Mercado Pago shape allowed to reach a page or a component.
 *
 * The access token is absent by construction. A type that cannot carry it
 * cannot leak it through a serialized prop, a logged object or an error
 * payload, which is a stronger guarantee than every consumer remembering to
 * strip it — the same reasoning `TransferDetails` applies to the public flow.
 *
 * `lastFour` and `changedAt` are here for a specific reason: because the token
 * itself is never shown, a presence flag alone cannot distinguish "the new
 * token is stored" from "the old one is still stored" after a save whose
 * outcome was uncertain. These two answer that without disclosing anything.
 */
export type MercadoPagoView = {
  configured: boolean;
  publicKey: string | null;
  /**
   * `'test'` only when the credential says so outright; `null` means unknown,
   * which is the normal case. Never rendered as "production" — see
   * `credentialEnvironment`.
   */
  environment: 'test' | null;
  /*
   * `accountId` was removed here (2026-08-13). It carried the token's trailing
   * segment as the Mercado Pago account; a real credential showed the segment
   * and the owner's User ID are different numbers. The dashboard therefore
   * names no account at all — the only verified identity is the one Mercado
   * Pago returns during a confirmation. See T43.
   */
  lastFour: string | null;
  changedAt: Date | null;
  /**
   * True when credentials are stored but cannot be decrypted (design D12).
   * Distinct from `configured: false` — the owner's remedy differs, and
   * reporting an unreadable credential as absent would be a lie about their
   * configuration.
   */
  unreadable: boolean;
};

/** True when the owner has given clients a way to pay online. */
export function hasMercadoPagoConfigured(credentials: MercadoPagoCredentials): boolean {
  return credentials.accessToken !== null && credentials.publicKey !== null;
}

/** True when the owner has given clients somewhere to send a transfer. */
export function hasTransferConfigured(transfer: TransferDetails): boolean {
  return transfer.cbuCvu !== null || transfer.alias !== null;
}

/**
 * True when a deposit policy has been chosen.
 *
 * Asked of the value, never of the type: the type always holds something,
 * because the column defaults so PC1's and PC2's writes can create the row
 * without inventing a policy. A row can therefore exist, and read `PERCENT`,
 * while no policy has ever been configured.
 */
export function hasDepositConfigured(policy: DepositPolicySettings): boolean {
  return policy.value !== null;
}

/**
 * The bookability gate of `docs/data-model.md` §14: at least one payment method
 * configured **and** a deposit policy chosen.
 *
 * This was deliberately left unwritten until PC3. PC1 declined it because a
 * rule with no caller implies an enforcement that does not exist — and PC1
 * explicitly permits clearing the transfer destination even when that leaves
 * the business unbookable, so it enforced nothing of the kind.
 *
 * It is still not an enforcement. PC3 **reports** it on the deposit editor; B4
 * **enforces** it at the entry to the booking flow. Both read this one
 * function, so the two surfaces cannot drift into different definitions of
 * ready — which is the whole reason it is here rather than inline on a page.
 */
export function isBookable(config: {
  hasMercadoPagoCredentials: boolean;
  transfer: TransferDetails;
  depositValue: string | null;
}): PaymentReadiness {
  const hasPaymentMethod =
    config.hasMercadoPagoCredentials || hasTransferConfigured(config.transfer);
  const hasDepositPolicy = config.depositValue !== null;

  return {
    ready: hasPaymentMethod && hasDepositPolicy,
    hasPaymentMethod,
    hasDepositPolicy,
  };
}
