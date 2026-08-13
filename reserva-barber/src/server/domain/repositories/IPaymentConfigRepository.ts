import type { PaymentConfig, TransferDetails } from '@/server/domain/models/PaymentConfig';

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
}
