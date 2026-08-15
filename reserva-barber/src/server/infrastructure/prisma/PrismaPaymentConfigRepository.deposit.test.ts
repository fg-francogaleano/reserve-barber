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

/**
 * A `Decimal`-shaped value, mimicking the driver **faithfully**.
 *
 * The driver's `toString()` drops a trailing zero — a stored `2000.50` reads
 * back as `2000.5` — which is exactly what the first version of this mock got
 * wrong, encoding an assumption instead of the behaviour. `toFixed(2)` is what
 * the conversion must actually use.
 */
function decimal(value: string) {
  const numeric = Number(value);
  return {
    toString: () => String(numeric),
    toFixed: (digits: number) => numeric.toFixed(digits),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaPaymentConfigRepository - the deposit policy write', () => {
  /**
   * PC1's design D5, binding on the third story to write this row. A write that
   * supplied the whole entity would reset the transfer destination or the
   * Mercado Pago credentials while reporting success.
   */
  it('should_name_only_the_two_deposit_columns_in_the_update_branch', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, {
      type: 'PERCENT',
      value: '30',
    });

    const call = paymentConfig.upsert.mock.calls[0]?.[0];
    expect(Object.keys(call.update).sort()).toEqual(['depositType', 'depositValue']);
  });

  it('should_name_only_the_two_deposit_columns_plus_the_owner_in_the_create_branch', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, {
      type: 'FIXED',
      value: '2000.00',
    });

    const call = paymentConfig.upsert.mock.calls[0]?.[0];
    expect(Object.keys(call.create).sort()).toEqual(['depositType', 'depositValue', 'ownerId']);
  });

  it('should_never_name_a_transfer_or_mercado_pago_column', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, {
      type: 'PERCENT',
      value: '30',
    });

    const call = paymentConfig.upsert.mock.calls[0]?.[0];
    const written = [...Object.keys(call.update), ...Object.keys(call.create)];
    for (const forbidden of [
      'transferCbuCvu',
      'transferAlias',
      'transferHolderName',
      'mpAccessToken',
      'mpPublicKey',
    ]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it('should_key_the_upsert_on_the_unique_owner', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, {
      type: 'PERCENT',
      value: '30',
    });

    expect(paymentConfig.upsert.mock.calls[0]?.[0].where).toEqual({ ownerId: OWNER });
  });

  /**
   * Clearing leaves `depositType` alone. The column cannot be null and the
   * stored type is a better default for the owner's next save than resetting
   * it to whatever the schema happens to prefer.
   */
  it('should_null_only_the_value_when_clearing', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, null);

    const call = paymentConfig.upsert.mock.calls[0]?.[0];
    expect(call.update).toEqual({ depositValue: null });
    expect(Object.keys(call.create).sort()).toEqual(['depositValue', 'ownerId']);
  });
});

describe('PrismaPaymentConfigRepository - the public deposit projection', () => {
  it('should_select_only_the_two_deposit_columns', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        depositType: 'PERCENT',
        depositValue: decimal('30.00'),
      }),
    });

    await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(paymentConfig.findUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: { depositType: true, depositValue: true },
    });
  });

  it('should_not_select_either_credential_column', async () => {
    const { db, paymentConfig } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        depositType: 'PERCENT',
        depositValue: decimal('30.00'),
      }),
    });

    await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    const select = paymentConfig.findUnique.mock.calls[0]?.[0].select;
    expect(select.mpAccessToken).toBeUndefined();
    expect(select.mpPublicKey).toBeUndefined();
  });

  it('should_return_null_when_no_row_exists', async () => {
    const { db } = createDb();

    const policy = await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(policy).toBeNull();
  });

  /**
   * A row with a null value is a real answer — configured business, no deposit
   * policy — and must not be collapsed into "no row" or filled with a default.
   * Inventing a policy is how a client gets charged an amount nobody chose.
   */
  it('should_report_an_unconfigured_policy_rather_than_substituting_a_default', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({ depositType: 'PERCENT', depositValue: null }),
    });

    const policy = await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(policy).toEqual({ type: 'PERCENT', value: null });
  });
});

describe('PrismaPaymentConfigRepository - the deposit value crosses as a string', () => {
  /**
   * Caught against the live database, not by this suite's first version: the
   * driver reads `2000.50` back as `2000.5`, and `toCents` would then read the
   * lone `5` as five centavos — a 45-peso deposit charged as 5 centavos short
   * of 2000. M3 documented this exact failure for `Service.price`; the fix is
   * its `toCanonicalPrice`, not a second conversion.
   */
  it('should_pad_a_trailing_zero_the_driver_drops', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        depositType: 'FIXED',
        depositValue: decimal('2000.50'),
      }),
    });

    const policy = await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(policy?.value).toBe('2000.50');
  });

  it('should_convert_the_driver_decimal_to_a_canonical_string_on_read', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        depositType: 'FIXED',
        depositValue: decimal('8000.50'),
      }),
    });

    const policy = await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(policy?.value).toBe('8000.50');
    expect(typeof policy?.value).toBe('string');
  });

  it('should_pad_a_whole_amount_to_two_decimals', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        depositType: 'FIXED',
        depositValue: decimal('2000'),
      }),
    });

    const policy = await new PrismaPaymentConfigRepository(db).findDepositPolicyForPublic(OWNER);

    expect(policy?.value).toBe('2000.00');
  });

  it('should_pass_the_value_to_the_driver_without_a_float_conversion', async () => {
    const { db, paymentConfig } = createDb();

    await new PrismaPaymentConfigRepository(db).upsertDepositPolicy(OWNER, {
      type: 'FIXED',
      value: '8000.50',
    });

    const call = paymentConfig.upsert.mock.calls[0]?.[0];
    expect(call.update.depositValue).toBe('8000.50');
    expect(typeof call.update.depositValue).not.toBe('number');
  });

  it('should_read_back_what_the_dashboard_read_already_converts', async () => {
    const { db } = createDb({
      findUnique: vi.fn().mockResolvedValue({
        id: 'cfg-1',
        ownerId: OWNER,
        mpPublicKey: null,
        mpAccessToken: null,
        transferCbuCvu: CBU,
        transferAlias: null,
        transferHolderName: 'Barberia Franco',
        depositType: 'FIXED',
        depositValue: decimal('8000.50'),
        updatedAt: new Date('2026-08-14T12:00:00Z'),
      }),
    });

    const config = await new PrismaPaymentConfigRepository(db).findByOwner(OWNER);

    expect(config?.depositValue).toBe('8000.50');
  });
});
