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
};

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
