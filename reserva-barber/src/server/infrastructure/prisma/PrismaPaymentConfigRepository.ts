import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { PaymentConfig, TransferDetails } from '@/server/domain/models/PaymentConfig';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * What the dashboard needs. Never `SELECT *`, and note what is absent:
 * `mpAccessToken` is not selected even here. The dashboard has no use for its
 * value — PC2 needs to know only whether one is stored — and a field that is
 * never read cannot be logged, serialized or passed onward by accident.
 */
const DASHBOARD_FIELDS = {
  id: true,
  ownerId: true,
  mpPublicKey: true,
  transferCbuCvu: true,
  transferAlias: true,
  transferHolderName: true,
  depositType: true,
  depositValue: true,
} as const;

/**
 * What the public booking flow needs, and nothing else (design D7).
 *
 * The narrowness is the security control. `mpAccessToken` shares this row, and
 * a projection that does not select it cannot leak it through a serialized
 * prop, a logged object or an error payload — a stronger guarantee than every
 * downstream consumer remembering to strip it.
 */
const PUBLIC_TRANSFER_FIELDS = {
  transferCbuCvu: true,
  transferAlias: true,
  transferHolderName: true,
} as const;

export class PrismaPaymentConfigRepository implements IPaymentConfigRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByOwner(ownerId: string): Promise<PaymentConfig | null> {
    const row = await this.db.paymentConfig.findUnique({
      where: { ownerId },
      select: { ...DASHBOARD_FIELDS, mpAccessToken: true },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      ownerId: row.ownerId,
      mpPublicKey: row.mpPublicKey,
      // Reduced to a boolean at the boundary: the value never travels further
      // than this line, so nothing above the repository can leak it.
      hasMercadoPagoCredentials: row.mpAccessToken !== null,
      transfer: {
        cbuCvu: row.transferCbuCvu,
        alias: row.transferAlias,
        holderName: row.transferHolderName,
      },
      depositType: row.depositType,
      // Decimal to string at the boundary: the domain never handles the driver's
      // Decimal type, and a float conversion would lose money.
      depositValue: row.depositValue === null ? null : row.depositValue.toString(),
    };
  }

  async findTransferDetailsForPublic(ownerId: string): Promise<TransferDetails | null> {
    const row = await this.db.paymentConfig.findUnique({
      where: { ownerId },
      select: PUBLIC_TRANSFER_FIELDS,
    });
    if (!row) {
      return null;
    }
    return {
      cbuCvu: row.transferCbuCvu,
      alias: row.transferAlias,
      holderName: row.transferHolderName,
    };
  }

  /**
   * Keyed on the unique `ownerId`, which is what makes a retry after a
   * committed-but-timed-out save a no-op rather than a duplicate row.
   *
   * **Both branches name only the three transfer columns** (design D5). Three
   * stories share this row; a whole-entity write would silently reset PC2's
   * credentials or PC3's deposit policy while reporting success. The create
   * branch supplies nothing else either — `depositType` takes its schema
   * default and `depositValue` stays null until PC3.
   */
  async upsertTransferDetails(ownerId: string, details: TransferDetails): Promise<void> {
    const columns = {
      transferCbuCvu: details.cbuCvu,
      transferAlias: details.alias,
      transferHolderName: details.holderName,
    };

    await this.db.paymentConfig.upsert({
      where: { ownerId },
      create: { ownerId, ...columns },
      update: columns,
    });
  }
}
