import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaPaymentConfigRepository } from './PrismaPaymentConfigRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import type { ICredentialCipher } from '@/server/domain/repositories/ICredentialCipher';
import { CredentialDecryptionError } from '@/server/domain/errors/PaymentConfigErrors';

const OWNER = 'owner-root';
const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const ENVELOPE = 'v1.aXYtYnl0ZXM.Y2lwaGVydGV4dA';

function createDb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const paymentConfig = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return { db: { paymentConfig } as unknown as PrismaClient, paymentConfig };
}

/** A stand-in cipher: reversible, obviously not real, and easy to assert on. */
function createCipher(): ICredentialCipher & { encrypt: ReturnType<typeof vi.fn> } {
  return {
    encrypt: vi.fn().mockResolvedValue(ENVELOPE),
    decrypt: vi.fn().mockResolvedValue(TOKEN),
  } as unknown as ICredentialCipher & { encrypt: ReturnType<typeof vi.fn> };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaPaymentConfigRepository - the Mercado Pago write', () => {
  it('should_name_only_the_two_credential_columns_in_both_branches', async () => {
    // PC1's design D5, now binding on a second write. A whole-entity write
    // would silently reset the transfer destination or the deposit policy
    // while reporting success.
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db, createCipher()).upsertMercadoPagoCredentials(
      OWNER,
      { accessToken: TOKEN, publicKey: KEY }
    );

    expect(paymentConfig.upsert).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      create: { ownerId: OWNER, mpAccessToken: ENVELOPE, mpPublicKey: KEY },
      update: { mpAccessToken: ENVELOPE, mpPublicKey: KEY },
    });
  });

  it('should_not_touch_the_transfer_or_deposit_columns', async () => {
    // The regression that would otherwise be discovered by a client's deposit
    // disappearing.
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db, createCipher()).upsertMercadoPagoCredentials(
      OWNER,
      { accessToken: TOKEN, publicKey: KEY }
    );

    const call = paymentConfig.upsert.mock.calls[0][0];
    const written = { ...call.create, ...call.update };
    for (const forbidden of [
      'transferCbuCvu',
      'transferAlias',
      'transferHolderName',
      'depositType',
      'depositValue',
    ]) {
      expect(written).not.toHaveProperty(forbidden);
    }
  });

  it('should_encrypt_the_token_at_the_boundary', async () => {
    const cipher = createCipher();
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db, cipher).upsertMercadoPagoCredentials(OWNER, {
      accessToken: TOKEN,
      publicKey: KEY,
    });

    expect(cipher.encrypt).toHaveBeenCalledWith(TOKEN, OWNER, 'mp-access-token');
    expect(JSON.stringify(paymentConfig.upsert.mock.calls[0][0])).not.toContain(TOKEN);
  });

  it('should_store_the_public_key_unencrypted', async () => {
    // It is disclosed to every client at the payment step; encrypting it would
    // put a decryption step on a public read path in exchange for nothing.
    const cipher = createCipher();
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db, cipher).upsertMercadoPagoCredentials(OWNER, {
      accessToken: TOKEN,
      publicKey: KEY,
    });

    expect(paymentConfig.upsert.mock.calls[0][0].update.mpPublicKey).toBe(KEY);
    expect(cipher.encrypt).toHaveBeenCalledTimes(1);
  });

  it('should_write_nulls_without_calling_the_cipher_when_removing', async () => {
    const cipher = createCipher();
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db, cipher).upsertMercadoPagoCredentials(OWNER, {
      accessToken: null,
      publicKey: null,
    });

    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(paymentConfig.upsert.mock.calls[0][0].update).toEqual({
      mpAccessToken: null,
      mpPublicKey: null,
    });
  });

  it('should_refuse_to_write_without_a_cipher_rather_than_storing_plaintext', async () => {
    // The failure this whole design exists to prevent. A repository wired
    // without a cipher must not quietly become one that stores bearer tokens
    // in the clear.
    const { db, paymentConfig } = createDb();

    await expect(
      new PrismaPaymentConfigRepository(db).upsertMercadoPagoCredentials(OWNER, {
        accessToken: TOKEN,
        publicKey: KEY,
      })
    ).rejects.toThrow(/requires a cipher/);
    expect(paymentConfig.upsert).not.toHaveBeenCalled();
  });
});

describe('PrismaPaymentConfigRepository - the public key projection', () => {
  it('should_select_only_the_public_key', async () => {
    // The narrowness is the control: a projection that does not select the
    // token cannot leak it into the browser bundle that renders the checkout.
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpPublicKey: KEY }),
    });

    await new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoPublicKeyForPublic(
      OWNER
    );

    expect(paymentConfig.findUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: { mpPublicKey: true },
    });
  });

  it('should_not_select_the_access_token_column', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpPublicKey: KEY }),
    });

    await new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoPublicKeyForPublic(
      OWNER
    );

    expect(paymentConfig.findUnique.mock.calls[0][0].select).not.toHaveProperty('mpAccessToken');
  });

  it('should_return_null_when_nothing_is_configured', async () => {
    const { db } = createDb();

    await expect(
      new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoPublicKeyForPublic(OWNER)
    ).resolves.toBeNull();
  });
});

describe('PrismaPaymentConfigRepository - the server-side token read', () => {
  it('should_select_only_the_token_column', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpAccessToken: ENVELOPE }),
    });

    await new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoAccessToken(OWNER);

    expect(paymentConfig.findUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: { mpAccessToken: true },
    });
  });

  it('should_return_the_decrypted_plaintext', async () => {
    const cipher = createCipher();
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpAccessToken: ENVELOPE }),
    });

    const token = await new PrismaPaymentConfigRepository(db, cipher).findMercadoPagoAccessToken(
      OWNER
    );

    expect(token).toBe(TOKEN);
    expect(cipher.decrypt).toHaveBeenCalledWith(ENVELOPE, OWNER, 'mp-access-token');
  });

  it('should_return_null_when_no_credential_is_stored', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpAccessToken: null }),
    });

    await expect(
      new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoAccessToken(OWNER)
    ).resolves.toBeNull();
  });

  it('should_return_null_when_the_row_does_not_exist', async () => {
    const { db } = createDb();

    await expect(
      new PrismaPaymentConfigRepository(db, createCipher()).findMercadoPagoAccessToken(OWNER)
    ).resolves.toBeNull();
  });

  // The distinction the caller must be able to draw: an absent credential and
  // an unreadable one lead to different advice for the owner.
  it('should_surface_a_decryption_failure_rather_than_returning_null', async () => {
    const cipher = createCipher();
    vi.mocked(cipher.decrypt).mockRejectedValue(new CredentialDecryptionError());
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpAccessToken: ENVELOPE }),
    });

    await expect(
      new PrismaPaymentConfigRepository(db, cipher).findMercadoPagoAccessToken(OWNER)
    ).rejects.toBeInstanceOf(CredentialDecryptionError);
  });
});

describe('PrismaPaymentConfigRepository - owner scoping', () => {
  it('should_carry_the_owner_predicate_on_every_new_query', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({ mpPublicKey: KEY, mpAccessToken: ENVELOPE }),
    });
    const repository = new PrismaPaymentConfigRepository(db, createCipher());

    await repository.findMercadoPagoPublicKeyForPublic(OWNER);
    await repository.findMercadoPagoAccessToken(OWNER);
    await repository.upsertMercadoPagoCredentials(OWNER, { accessToken: TOKEN, publicKey: KEY });

    for (const call of [...paymentConfig.findUnique.mock.calls, ...paymentConfig.upsert.mock.calls]) {
      expect(call[0].where).toEqual({ ownerId: OWNER });
    }
  });
});
