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
 * The full configuration, for the dashboard only.
 *
 * `depositValue` is nullable because the row is created by whichever payment
 * story the owner completes first, and no deposit policy exists until PC3. The
 * guarantee that a business can accept bookings is therefore an application
 * gate, not a column constraint — see `isBookable` below.
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

/*
 * The bookability gate — "at least one payment method configured AND a non-null
 * depositValue" — is deliberately NOT implemented here.
 *
 * It is stated as a rule in docs/data-model.md §14 and belongs at the entry to
 * the public booking flow, which does not exist yet. Writing it now would add a
 * code path with no caller and imply this story enforces something it does not:
 * PC1 explicitly permits clearing the transfer destination even when that
 * leaves the business unbookable, because blocking it would trap an owner
 * migrating between payment methods. The same reasoning M4 applied when it
 * declined to pre-write an upsert with no caller.
 *
 * PC3 and B4 are the stories that implement it.
 */
