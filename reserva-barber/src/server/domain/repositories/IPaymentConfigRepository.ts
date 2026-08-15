import type {
  PaymentConfig,
  TransferDetails,
  MercadoPagoCredentials,
  DepositPolicySettings,
  DepositPolicyInput,
} from '@/server/domain/models/PaymentConfig';

/**
 * Repository contract for the owner's payment configuration.
 *
 * Every method takes `ownerId`, so an unscoped query is inexpressible. Unlike
 * every other repository in this project, the aggregate is a **single row**
 * shared by three stories, which drives two of the three methods below.
 */
export interface IPaymentConfigRepository {
  /**
   * The full configuration for the dashboard. Returns `null` when the owner has
   * not configured anything yet — the row is created by the first save, never
   * by a migration, a seed or a provisioning script.
   */
  findByOwner(ownerId: string): Promise<PaymentConfig | null>;

  /**
   * The transfer destination for the public booking flow, as a narrow
   * projection (design D7).
   *
   * Kept separate from `findByOwner` for the same reason M5b kept absence
   * periods separate from absences: `mpAccessToken` shares this row, and a
   * projection that does not select it cannot leak it — a stronger guarantee
   * than every downstream consumer remembering to strip it.
   */
  findTransferDetailsForPublic(ownerId: string): Promise<TransferDetails | null>;

  /**
   * Writes the transfer destination, creating the row if it does not exist.
   *
   * Implementations MUST name only the three transfer columns in both branches
   * (design D5). Three stories share this row, and a whole-entity write would
   * silently reset the Mercado Pago credentials or the deposit policy while
   * reporting success.
   *
   * Keyed on the unique `ownerId`, which is what makes a retry after a
   * committed-but-timed-out save a no-op rather than a duplicate row.
   */
  upsertTransferDetails(ownerId: string, details: TransferDetails): Promise<void>;

  /**
   * Writes the Mercado Pago credential pair, creating the row if it does not
   * exist (PC2).
   *
   * Implementations MUST name only `mpAccessToken` and `mpPublicKey` in both
   * branches, for the same reason `upsertTransferDetails` names only its three
   * — this is PC1's design D5, now binding on a second write.
   *
   * Takes **plaintext**. Encryption happens at the persistence boundary
   * (design D2), alongside the Decimal-to-string conversion already there, so
   * no layer above this one ever holds an envelope it could log, serialize, or
   * forget to decrypt.
   */
  upsertMercadoPagoCredentials(
    ownerId: string,
    credentials: MercadoPagoCredentials
  ): Promise<void>;

  /**
   * The public key alone, for the surface that renders the client-side
   * checkout (B5).
   *
   * Separate from every other read, and never widened. The public key is safe
   * in the browser; the access token shares its row and is not. A projection
   * that does not select the token cannot leak it.
   */
  findMercadoPagoPublicKeyForPublic(ownerId: string): Promise<string | null>;

  /**
   * The decrypted access token, for server-side use only (B5). Its result must
   * never be passed to a component, serialized into a response, or logged.
   *
   * Returns `null` when no credential is stored, and **throws**
   * `CredentialDecryptionError` when one is stored but cannot be read. A caller
   * that cannot tell those apart reports an owner's configured credentials as
   * missing, or as usable when they are not — both wrong, and both surfacing
   * far from their cause.
   */
  findMercadoPagoAccessToken(ownerId: string): Promise<string | null>;

  /**
   * Writes the deposit policy, creating the row if it does not exist (PC3).
   *
   * Implementations MUST name only `depositType` and `depositValue` in both
   * branches — PC1's design D5, now binding on the third and last write that
   * shares this row.
   *
   * Takes `null` to clear the policy, which sets `depositValue` back to null
   * and leaves `depositType` as stored. Clearing is permitted even when it
   * leaves the business unable to accept bookings: an owner migrating between
   * models must not be trapped, exactly as PC1 settled for the transfer
   * destination.
   */
  upsertDepositPolicy(ownerId: string, policy: DepositPolicyInput | null): Promise<void>;

  /**
   * The deposit policy alone, for the surface that computes what a client owes
   * (B4/B5/B6).
   *
   * Separate from every other read, and never widened, for the reason the
   * transfer and public-key projections exist: `mpAccessToken` shares this row,
   * and a projection that does not select it cannot leak it.
   *
   * Returns `null` when no row exists. A row whose `value` is null is a real
   * answer — the owner has a configuration but no deposit policy — and callers
   * must not substitute a default for it, because inventing a policy is how a
   * client gets charged an amount the owner never chose.
   */
  findDepositPolicyForPublic(ownerId: string): Promise<DepositPolicySettings | null>;
}
