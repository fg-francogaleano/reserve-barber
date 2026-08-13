import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { PaymentConfig, TransferDetails } from '@/server/domain/models/PaymentConfig';
import { hasTransferConfigured } from '@/server/domain/models/PaymentConfig';
import { PaymentConfigWriteConflictError } from '@/server/domain/errors/PaymentConfigErrors';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

export type SaveTransferResult =
  /**
   * The destination differs from the stored one and has not been confirmed.
   * Nothing was written. `pending` carries the **normalized** value, which is
   * what the owner must be shown — confirming what they typed rather than what
   * would be stored would confirm the wrong thing (design D14).
   */
  | { status: 'needs_confirmation'; pending: TransferDetails }
  /**
   * Written. `leavesNoPaymentMethod` is computed here rather than in the
   * browser: only the server knows whether PC2 has configured Mercado Pago,
   * and the warning must work before hydration (design D16).
   */
  | { status: 'saved'; leavesNoPaymentMethod: boolean };

export interface SaveTransferOptions {
  /** Set by the owner's explicit confirmation of a changed destination. */
  confirmed: boolean;
}

function destinationChanged(stored: TransferDetails, next: TransferDetails): boolean {
  return stored.cbuCvu !== next.cbuCvu || stored.alias !== next.alias;
}

export class PaymentConfigService {
  constructor(private readonly configs: IPaymentConfigRepository) {}

  getConfig(ownerId: string): Promise<PaymentConfig | null> {
    return this.configs.findByOwner(ownerId);
  }

  getTransferDetailsForPublic(ownerId: string): Promise<TransferDetails | null> {
    return this.configs.findTransferDetailsForPublic(ownerId);
  }

  async saveTransferDetails(
    ownerId: string,
    details: TransferDetails,
    options: SaveTransferOptions
  ): Promise<SaveTransferResult> {
    const existing = await this.configs.findByOwner(ownerId);

    // Confirmation is deliberately narrow: never on a first configuration,
    // never when only the holder name changed, never on an unchanged re-save.
    // Friction on every save is friction that gets clicked through, and this
    // step is the only defence left against an alias that is valid but belongs
    // to someone else — no checksum can catch that (design D14).
    //
    // The test is whether a destination is STORED, not whether a row exists.
    // The row can exist with no destination at all — after the owner cleared
    // it, and later once PC2 creates the row for Mercado Pago alone — and going
    // from nothing to something has no previous value to be confused with. The
    // risk this step exists for is silently REPLACING a destination that was
    // already right.
    const replacingStoredDestination =
      existing !== null &&
      hasTransferConfigured(existing.transfer) &&
      destinationChanged(existing.transfer, details);

    if (!options.confirmed && replacingStoredDestination) {
      return { status: 'needs_confirmation', pending: details };
    }

    await this.writeWithSingleRetry(ownerId, details);

    const hasMercadoPago = existing?.hasMercadoPagoCredentials ?? false;
    return {
      status: 'saved',
      leavesNoPaymentMethod: !hasMercadoPago && !hasTransferConfigured(details),
    };
  }

  /**
   * Absorbs the one violation this write can legitimately produce (design D12).
   *
   * Two concurrent saves against a row that does not yet exist both take the
   * upsert's create branch; the loser receives a unique-constraint violation
   * having done nothing wrong, and reporting that as an infrastructure failure
   * tells the owner their save failed when the stored data is correct. The
   * retry finds the row and takes the update path.
   *
   * Bounded at exactly one attempt. A second violation is a real failure and is
   * surfaced rather than retried again.
   */
  private async writeWithSingleRetry(ownerId: string, details: TransferDetails): Promise<void> {
    try {
      await this.configs.upsertTransferDetails(ownerId, details);
      return;
    } catch (error) {
      if (!hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw error;
      }
    }

    try {
      await this.configs.upsertTransferDetails(ownerId, details);
    } catch (error) {
      if (hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new PaymentConfigWriteConflictError();
      }
      throw error;
    }
  }
}
