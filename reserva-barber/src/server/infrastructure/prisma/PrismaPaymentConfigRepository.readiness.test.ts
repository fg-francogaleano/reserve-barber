import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaPaymentConfigRepository } from './PrismaPaymentConfigRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const CBU = '2850590940090418135201';

function createDb(
  row: unknown = {
    transferCbuCvu: CBU,
    transferAlias: null,
    transferHolderName: 'Barberia Franco',
    depositType: 'PERCENT',
    depositValue: '25',
  },
  presence: { hasMercadoPagoCredentials: boolean }[] = [{ hasMercadoPagoCredentials: true }]
) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const queryRaw = vi.fn().mockResolvedValue(presence);
  return {
    db: { paymentConfig: { findUnique }, $queryRaw: queryRaw } as unknown as PrismaClient,
    findUnique,
    queryRaw,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('findPaymentReadinessForPublic - the credential never enters the process', () => {
  it('should_not_select_the_access_token_column', async () => {
    // The guarantee B1, B2 and B3 held by wiring no payment repository at all
    // now lives in the projection: a query that does not select the column
    // cannot leak it.
    const { db, findUnique } = createDb();

    await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(OWNER);

    const call = findUnique.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(call.select).not.toHaveProperty('mpAccessToken');
    expect(call.select).not.toHaveProperty('mpPublicKey');
  });

  it('should_answer_credential_presence_in_sql_rather_than_in_typescript', async () => {
    const { db, queryRaw } = createDb();

    await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(OWNER);

    const sql = String(queryRaw.mock.calls[0]![0]);
    expect(sql).toContain('IS NOT NULL');
    expect(queryRaw.mock.calls[0]).toContain(OWNER);
  });

  it('should_reduce_mercado_pago_to_a_boolean', async () => {
    const { db } = createDb(undefined, [{ hasMercadoPagoCredentials: true }]);

    const readiness = await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(
      OWNER
    );

    expect(readiness?.hasMercadoPagoCredentials).toBe(true);
    // The returned shape has no field an access token could occupy.
    expect(JSON.stringify(readiness)).not.toContain('AccessToken');
  });

  it('should_scope_the_read_on_the_owner', async () => {
    const { db, findUnique } = createDb();

    await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(OWNER);

    const call = findUnique.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ ownerId: OWNER });
  });
});

describe('findPaymentReadinessForPublic - the states it reports', () => {
  it('should_return_null_when_no_configuration_row_exists', async () => {
    const { db } = createDb(null, []);

    await expect(
      new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(OWNER)
    ).resolves.toBeNull();
  });

  it('should_report_an_unconfigured_deposit_policy_as_null_never_as_a_default', async () => {
    // Inventing a policy is how a client gets charged an amount nobody chose.
    const { db } = createDb({
      transferCbuCvu: CBU,
      transferAlias: null,
      transferHolderName: 'Barberia Franco',
      depositType: 'PERCENT',
      depositValue: null,
    });

    const readiness = await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(
      OWNER
    );

    expect(readiness?.depositValue).toBeNull();
  });

  it('should_carry_the_deposit_value_as_a_canonical_decimal_string', async () => {
    // The driver drops a trailing zero, and integer-cent arithmetic then reads
    // a stored 2000.50 as five centavos.
    const { db } = createDb({
      transferCbuCvu: CBU,
      transferAlias: null,
      transferHolderName: 'Barberia Franco',
      depositType: 'FIXED',
      depositValue: '2000.5',
    });

    const readiness = await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(
      OWNER
    );

    expect(readiness?.depositValue).toBe('2000.50');
  });

  it('should_report_no_credentials_when_the_presence_query_returns_nothing', async () => {
    // Fail closed: an unanswerable presence check must not read as configured.
    const { db } = createDb(undefined, []);

    const readiness = await new PrismaPaymentConfigRepository(db).findPaymentReadinessForPublic(
      OWNER
    );

    expect(readiness?.hasMercadoPagoCredentials).toBe(false);
  });
});
