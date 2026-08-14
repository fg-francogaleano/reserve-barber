import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type {
  PaymentConfig,
  TransferDetails,
  MercadoPagoCredentials,
} from '@/server/domain/models/PaymentConfig';
import type { ICredentialCipher } from '@/server/domain/repositories/ICredentialCipher';
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
  // PC2: lets the dashboard distinguish a completed rotation from an uncertain
  // one without ever handling the token.
  updatedAt: true,
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

/**
 * The public key alone (PC2, design D13). Named separately from
 * `PUBLIC_TRANSFER_FIELDS` for the same reason that one exists: the narrowness
 * is the control, and a projection that does not select `mpAccessToken` cannot
 * leak it into the browser bundle that renders the checkout.
 */
const PUBLIC_MP_FIELDS = {
  mpPublicKey: true,
} as const;

/** The encrypted token alone, for the one server-side caller allowed to read it. */
const MP_TOKEN_FIELDS = {
  mpAccessToken: true,
} as const;

export class PrismaPaymentConfigRepository implements IPaymentConfigRepository {
  /**
   * The cipher is optional so PC1's transfer paths and their tests construct
   * this repository unchanged. Every Mercado Pago method reports its absence as
   * the wiring mistake it is — never by silently storing a token in plaintext,
   * which is the failure this whole design exists to prevent.
   */
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher?: ICredentialCipher
  ) {}

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
      updatedAt: row.updatedAt,
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

  /**
   * **Both branches name only the two Mercado Pago columns** — PC1's design D5,
   * now binding on a second write. A whole-entity write would silently reset
   * the transfer destination or the deposit policy while reporting success.
   *
   * The token is encrypted here, at the boundary (design D2), alongside the
   * Decimal conversion above. Callers pass plaintext and never hold an envelope
   * they could log, serialize, or forget to decrypt.
   */
  async upsertMercadoPagoCredentials(
    ownerId: string,
    credentials: MercadoPagoCredentials
  ): Promise<void> {
    const columns = {
      mpAccessToken:
        credentials.accessToken === null
          ? null
          : await this.requireCipher().encrypt(credentials.accessToken, ownerId, 'mp-access-token'),
      mpPublicKey: credentials.publicKey,
    };

    await this.db.paymentConfig.upsert({
      where: { ownerId },
      create: { ownerId, ...columns },
      update: columns,
    });
  }

  async findMercadoPagoPublicKeyForPublic(ownerId: string): Promise<string | null> {
    const row = await this.db.paymentConfig.findUnique({
      where: { ownerId },
      select: PUBLIC_MP_FIELDS,
    });
    return row?.mpPublicKey ?? null;
  }

  /**
   * Returns plaintext, or null when nothing is stored. **Throws**
   * `CredentialDecryptionError` when a credential is stored but unreadable —
   * the caller must be able to tell those apart, or it reports the owner's
   * configured credentials as missing.
   */
  async findMercadoPagoAccessToken(ownerId: string): Promise<string | null> {
    const row = await this.db.paymentConfig.findUnique({
      where: { ownerId },
      select: MP_TOKEN_FIELDS,
    });
    if (!row || row.mpAccessToken === null) {
      return null;
    }
    return this.requireCipher().decrypt(row.mpAccessToken, ownerId, 'mp-access-token');
  }

  private requireCipher(): ICredentialCipher {
    if (this.cipher === undefined) {
      // Loud, and never a fallback to plaintext. A repository wired without a
      // cipher must not quietly become one that stores bearer tokens in the
      // clear.
      throw new Error('PrismaPaymentConfigRepository requires a cipher for Mercado Pago columns');
    }
    return this.cipher;
  }
}
