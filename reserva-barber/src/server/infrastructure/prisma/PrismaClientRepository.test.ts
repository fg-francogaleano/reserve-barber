import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaClientRepository } from './PrismaClientRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';

function createDb(behaviour: { upsert?: ReturnType<typeof vi.fn> } = {}) {
  const upsert = behaviour.upsert ?? vi.fn().mockResolvedValue({ id: 'cli-1' });
  return { db: { client: { upsert } } as unknown as PrismaClient, upsert };
}

function contact(overrides: Record<string, string> = {}) {
  return {
    ownerId: OWNER,
    name: 'Ana Pérez',
    email: 'ana@mail.com',
    phone: '+5491155554444',
    ...overrides,
  };
}

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaClientRepository - dedup is a conflict-aware write', () => {
  it('should_key_the_upsert_on_owner_and_email', async () => {
    // Not a read followed by a write: the two would be separate round trips
    // through a transaction-mode pooler and may not share a connection, so the
    // unique constraint is the guarantee.
    const { db, upsert } = createDb();

    await new PrismaClientRepository(db).resolve(contact());

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_email: { ownerId: OWNER, email: 'ana@mail.com' } },
      })
    );
  });

  it('should_update_only_the_name_and_phone_on_a_returning_client', async () => {
    // The owner needs the number that answers today. The email is the key it
    // was found by and is never rewritten.
    const { db, upsert } = createDb();

    await new PrismaClientRepository(db).resolve(contact());

    const call = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(call.update).toEqual({ name: 'Ana Pérez', phone: '+5491155554444' });
  });

  it('should_scope_the_row_to_the_owner_on_create', async () => {
    // The same person booking at two unrelated barbershops is two client
    // records: neither owner may see the other's customer list.
    const { db, upsert } = createDb();

    await new PrismaClientRepository(db).resolve(contact());

    const call = upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(call.create).toMatchObject({ ownerId: OWNER });
  });

  it('should_select_only_the_id', async () => {
    const { db, upsert } = createDb();

    await new PrismaClientRepository(db).resolve(contact());

    const call = upsert.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(call.select).toEqual({ id: true });
  });
});

describe('PrismaClientRepository - the race on a first-ever booking', () => {
  it('should_retry_once_after_a_unique_violation_and_succeed', async () => {
    // Two first bookings from the same address: both find no row, both attempt
    // the insert, one loses. The retry finds the winner's row.
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 'cli-winner' });
    const { db } = createDb({ upsert });

    await expect(new PrismaClientRepository(db).resolve(contact())).resolves.toEqual({
      id: 'cli-winner',
    });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('should_not_retry_more_than_once', async () => {
    // A second violation is a real failure, not a race, and retrying again
    // would loop against a condition that is not going to clear.
    const upsert = vi.fn().mockRejectedValue(uniqueViolation());
    const { db } = createDb({ upsert });

    await expect(new PrismaClientRepository(db).resolve(contact())).rejects.toThrow();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('should_not_retry_an_error_that_is_not_a_unique_violation', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('connection reset'));
    const { db } = createDb({ upsert });

    await expect(new PrismaClientRepository(db).resolve(contact())).rejects.toThrow(
      'connection reset'
    );
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
