import { describe, it, expect, vi } from 'vitest';
import { PrismaBookingReminderRepository } from './PrismaBookingReminderRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const WINDOW_END = new Date('2026-08-30T12:00:00.000Z');

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bkg-1',
    startTime: new Date('2026-08-30T11:00:00.000Z'),
    createdAt: new Date('2026-08-20T09:00:00.000Z'),
    ...overrides,
  };
}

/**
 * What the driver hands back for the message projection, including the scale it
 * drops: a stored `2000.50` arrives as `2000.5`, the defect PC3 measured and
 * every money projection in this repository converts against.
 */
function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bkg-1',
    startTime: new Date('2026-08-30T11:00:00.000Z'),
    priceAtBooking: '9000',
    depositAmount: '2000.5',
    cancellationToken: 'tok-abc123',
    client: { name: 'Ana Pérez', email: 'ana@example.com' },
    service: { name: 'Corte y barba' },
    barber: {
      displayName: 'Nico',
      location: {
        name: 'Sucursal Palermo',
        address: 'Gorriti 4500',
        owner: {
          businessProfile: { businessName: 'Barbería Central', publicSlug: 'barberia-central' },
        },
      },
    },
    ...overrides,
  };
}

/**
 * A client exposing **only** what this repository is allowed to reach for.
 *
 * B4's lesson stated as code, and `PrismaExpiredHoldRepository.test.ts`'s
 * pattern: a mock that offers more than the real path uses certifies calls
 * nobody made. In particular there is no `$transaction` and no `$executeRaw`,
 * because this repository must open no transaction and take no lock — so an
 * implementation that reached for either fails as "not a function" rather than
 * passing quietly.
 *
 * There is also **no `updateMany`**. The claim has to be the statement that
 * both marks and reports; a plain `updateMany` returns a count, which would
 * force a read-back that reintroduces the very window the claim exists to
 * close.
 */
function createDb(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      updateManyAndReturn: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function repository(db: ReturnType<typeof createDb>) {
  return new PrismaBookingReminderRepository(db as unknown as PrismaClient);
}

describe('PrismaBookingReminderRepository - finding candidates', () => {
  it('should_bound_the_query_below_by_now_and_above_by_the_window_end', async () => {
    // The lower bound is the safety property of this whole capability: without
    // it the first run selects every confirmed booking in history.
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where.startTime).toEqual({ gt: NOW, lt: WINDOW_END });
  });

  it('should_filter_on_the_status_and_the_null_claim', async () => {
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('CONFIRMED');
    expect(args.where.reminderEmailSentAt).toBeNull();
  });

  it('should_bound_the_rows_and_order_by_the_soonest_appointment', async () => {
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual({ startTime: 'asc' });
  });

  it('should_select_no_personal_data_for_a_row_that_may_never_be_sent_to', async () => {
    // A candidate is not yet a recipient: the predicate may reject it and the
    // claim may match zero rows. Reading a name and an address for a row that
    // will be discarded is personal data selected for nothing.
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual(['createdAt', 'id', 'startTime']);
  });

  it('should_not_restate_the_minimum_gap_rule_in_sql', async () => {
    // The gap belongs to `isReminderDue`. A copy of it here drifts from the
    // domain the first time either is refined — the constraint the sweep's
    // repository records about `blocksAvailability`.
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where.createdAt).toBeUndefined();
  });

  it('should_map_rows_to_the_candidate_shape', async () => {
    const db = createDb();
    db.booking.findMany.mockResolvedValue([candidateRow()]);

    const candidates = await repository(db).findDueCandidates({
      now: NOW,
      windowEnd: WINDOW_END,
      limit: 200,
    });

    expect(candidates).toEqual([
      {
        id: 'bkg-1',
        startTime: new Date('2026-08-30T11:00:00.000Z'),
        createdAt: new Date('2026-08-20T09:00:00.000Z'),
      },
    ]);
  });
});

describe('PrismaBookingReminderRepository - claiming', () => {
  it('should_guard_the_claim_on_the_status_and_on_the_column_still_being_null', async () => {
    // The whole of at-most-once. A booking cancelled, expired or claimed by an
    // overlapping invocation between the read and this call matches zero rows.
    const db = createDb();
    await repository(db).claimDue({ ids: ['bkg-1', 'bkg-2'], claimedAt: NOW });

    const args = db.booking.updateManyAndReturn.mock.calls[0][0];
    expect(args.where).toEqual({
      id: { in: ['bkg-1', 'bkg-2'] },
      status: 'CONFIRMED',
      reminderEmailSentAt: null,
    });
  });

  it('should_write_the_claim_instant_and_nothing_else', async () => {
    const db = createDb();
    await repository(db).claimDue({ ids: ['bkg-1'], claimedAt: NOW });

    const args = db.booking.updateManyAndReturn.mock.calls[0][0];
    expect(args.data).toEqual({ reminderEmailSentAt: NOW });
  });

  it('should_return_nothing_when_the_row_changed_underneath_the_run', async () => {
    // Zero rows matched is the ordinary path, not an error: it is what a
    // concurrent cancellation, a second run and an overlapping invocation all
    // look like from here.
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([]);

    const claimed = await repository(db).claimDue({ ids: ['bkg-1'], claimedAt: NOW });

    expect(claimed).toEqual([]);
    // And it must not go looking for the message projection of rows it did not
    // win — that read would be unscoped personal data for nobody.
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it('should_read_the_message_projection_only_for_the_ids_it_actually_won', async () => {
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([{ id: 'bkg-1' }]);
    db.booking.findMany.mockResolvedValue([messageRow()]);

    await repository(db).claimDue({ ids: ['bkg-1', 'bkg-2'], claimedAt: NOW });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: { in: ['bkg-1'] } });
  });

  it('should_convert_money_to_canonical_decimal_strings', async () => {
    // The driver returns a stored 2000.50 as 2000.5, and integer-cent
    // arithmetic downstream then reads the lone 5 as five centavos. Measured in
    // PC3, documented for Service.price in M3.
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([{ id: 'bkg-1' }]);
    db.booking.findMany.mockResolvedValue([messageRow()]);

    const [claimed] = await repository(db).claimDue({ ids: ['bkg-1'], claimedAt: NOW });

    expect(claimed.depositAmount).toBe('2000.50');
    expect(claimed.priceAtBooking).toBe('9000.00');
  });

  it('should_flatten_the_relations_into_the_message_shape_and_carry_no_phone', async () => {
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([{ id: 'bkg-1' }]);
    db.booking.findMany.mockResolvedValue([messageRow()]);

    const [claimed] = await repository(db).claimDue({ ids: ['bkg-1'], claimedAt: NOW });

    expect(claimed).toEqual({
      id: 'bkg-1',
      clientName: 'Ana Pérez',
      clientEmail: 'ana@example.com',
      shopName: 'Barbería Central',
      shopSlug: 'barberia-central',
      locationName: 'Sucursal Palermo',
      locationAddress: 'Gorriti 4500',
      barberName: 'Nico',
      serviceName: 'Corte y barba',
      startTime: new Date('2026-08-30T11:00:00.000Z'),
      priceAtBooking: '9000.00',
      depositAmount: '2000.50',
      cancellationToken: 'tok-abc123',
    });
    expect(claimed).not.toHaveProperty('clientPhone');
    expect(claimed).not.toHaveProperty('ownerId');
  });

  it('should_drop_a_row_whose_shop_has_no_public_profile_rather_than_compose_a_broken_link', async () => {
    // Unreachable today — the public slug IS the profile, so a booking cannot
    // exist without one — but the projection admits null, and a message whose
    // link is built on `undefined` is worse than one that was never sent.
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([{ id: 'bkg-1' }]);
    db.booking.findMany.mockResolvedValue([
      messageRow({
        barber: {
          displayName: 'Nico',
          location: {
            name: 'Sucursal Palermo',
            address: null,
            owner: { businessProfile: null },
          },
        },
      }),
    ]);

    const claimed = await repository(db).claimDue({ ids: ['bkg-1'], claimedAt: NOW });

    expect(claimed).toEqual([]);
  });

  it('should_issue_no_statement_for_an_empty_id_list', async () => {
    const db = createDb();
    const claimed = await repository(db).claimDue({ ids: [], claimedAt: NOW });

    expect(claimed).toEqual([]);
    expect(db.booking.updateManyAndReturn).not.toHaveBeenCalled();
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });
});

describe('PrismaBookingReminderRepository - cross-owner isolation', () => {
  it('should_claim_both_owners_due_bookings_and_key_on_nothing_owner_shaped', async () => {
    // The property this port has no enforcement for, so it is proven by test.
    // The fixture holds two owners: a run must serve both, and neither query
    // may carry an owner-shaped predicate — there is no owner in scope for a
    // job triggered by a clock.
    const db = createDb();
    db.booking.updateManyAndReturn.mockResolvedValue([{ id: 'a-1' }, { id: 'b-1' }]);
    db.booking.findMany.mockResolvedValue([
      messageRow({ id: 'a-1', cancellationToken: 'tok-a' }),
      messageRow({
        id: 'b-1',
        cancellationToken: 'tok-b',
        barber: {
          displayName: 'Sol',
          location: {
            name: 'Sucursal Centro',
            address: 'San Martín 100',
            owner: {
              businessProfile: { businessName: 'Barbería Norte', publicSlug: 'barberia-norte' },
            },
          },
        },
      }),
    ]);

    const claimed = await repository(db).claimDue({ ids: ['a-1', 'b-1'], claimedAt: NOW });

    expect(claimed.map((booking) => booking.shopSlug)).toEqual([
      'barberia-central',
      'barberia-norte',
    ]);

    const claimArgs = db.booking.updateManyAndReturn.mock.calls[0][0];
    expect(JSON.stringify(claimArgs.where)).not.toMatch(/owner/i);
  });

  it('should_carry_no_owner_predicate_on_the_candidate_query_either', async () => {
    const db = createDb();
    await repository(db).findDueCandidates({ now: NOW, windowEnd: WINDOW_END, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(JSON.stringify(args.where)).not.toMatch(/owner/i);
  });
});
