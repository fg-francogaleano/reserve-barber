import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaPaymentConfigRepository } from './PrismaPaymentConfigRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const CBU = '2850590940090418135201';

function createDb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const paymentConfig = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return { db: { paymentConfig } as unknown as PrismaClient, paymentConfig };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    ownerId: OWNER,
    mpPublicKey: null,
    mpAccessToken: null,
    transferCbuCvu: CBU,
    transferAlias: 'mi.barberia',
    transferHolderName: 'Barberia Franco',
    depositType: 'PERCENT',
    depositValue: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaPaymentConfigRepository - the dashboard read', () => {
  it('should_scope_by_owner_and_select_only_what_the_dashboard_needs', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue(row()),
    });

    await new PrismaPaymentConfigRepository(db).findByOwner(OWNER);

    expect(paymentConfig.findUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: {
        id: true,
        ownerId: true,
        mpPublicKey: true,
        transferCbuCvu: true,
        transferAlias: true,
        transferHolderName: true,
        depositType: true,
        depositValue: true,
        mpAccessToken: true,
      },
    });
  });

  it('should_return_null_when_the_owner_has_configured_nothing', async () => {
    const { db } = createDb();

    await expect(new PrismaPaymentConfigRepository(db).findByOwner(OWNER)).resolves.toBeNull();
  });

  it('should_reduce_the_access_token_to_a_boolean_at_the_boundary', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue(row({ mpAccessToken: 'APP_USR-secret' })),
    });

    const config = await new PrismaPaymentConfigRepository(db).findByOwner(OWNER);

    expect(config?.hasMercadoPagoCredentials).toBe(true);
    expect(JSON.stringify(config)).not.toContain('APP_USR-secret');
  });

  it('should_convert_the_deposit_value_to_a_string_rather_than_a_number', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue(
        row({ depositValue: { toString: () => '1500.50' } })
      ),
    });

    const config = await new PrismaPaymentConfigRepository(db).findByOwner(OWNER);

    expect(config?.depositValue).toBe('1500.50');
  });
});

describe('PrismaPaymentConfigRepository - the public projection', () => {
  it('should_select_only_the_three_transfer_columns', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        transferCbuCvu: CBU,
        transferAlias: 'mi.barberia',
        transferHolderName: 'Barberia Franco',
      }),
    });

    await new PrismaPaymentConfigRepository(db).findTransferDetailsForPublic(OWNER);

    expect(paymentConfig.findUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: {
        transferCbuCvu: true,
        transferAlias: true,
        transferHolderName: true,
      },
    });
  });

  it('should_return_an_object_that_carries_no_mercado_pago_field', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        transferCbuCvu: CBU,
        transferAlias: null,
        transferHolderName: 'Barberia Franco',
      }),
    });

    const details = await new PrismaPaymentConfigRepository(db).findTransferDetailsForPublic(OWNER);

    expect(Object.keys(details ?? {}).sort()).toEqual(['alias', 'cbuCvu', 'holderName']);
  });

  it('should_return_null_when_nothing_is_configured', async () => {
    const { db } = createDb();

    await expect(
      new PrismaPaymentConfigRepository(db).findTransferDetailsForPublic(OWNER)
    ).resolves.toBeNull();
  });
});

describe('PrismaPaymentConfigRepository - the transfer write', () => {
  it('should_upsert_on_the_owner_naming_only_the_transfer_columns', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertTransferDetails(OWNER, {
      cbuCvu: CBU,
      alias: 'mi.barberia',
      holderName: 'Barberia Franco',
    });

    expect(paymentConfig.upsert).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      create: {
        ownerId: OWNER,
        transferCbuCvu: CBU,
        transferAlias: 'mi.barberia',
        transferHolderName: 'Barberia Franco',
      },
      update: {
        transferCbuCvu: CBU,
        transferAlias: 'mi.barberia',
        transferHolderName: 'Barberia Franco',
      },
    });
  });

  it('should_never_name_a_column_belonging_to_another_payment_story', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertTransferDetails(OWNER, {
      cbuCvu: CBU,
      alias: null,
      holderName: 'Barberia Franco',
    });

    const call = paymentConfig.upsert.mock.calls[0][0];
    const forbidden = ['mpAccessToken', 'mpPublicKey', 'depositType', 'depositValue'];
    for (const column of forbidden) {
      expect(Object.keys(call.create)).not.toContain(column);
      expect(Object.keys(call.update)).not.toContain(column);
    }
  });

  it('should_write_nulls_when_the_owner_clears_the_destination', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertTransferDetails(OWNER, {
      cbuCvu: null,
      alias: null,
      holderName: null,
    });

    expect(paymentConfig.upsert.mock.calls[0][0].update).toEqual({
      transferCbuCvu: null,
      transferAlias: null,
      transferHolderName: null,
    });
  });
});
