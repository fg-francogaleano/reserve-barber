import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBookingRepository } from './PrismaBookingRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const BOOKING = 'bkg-1';
const START = new Date('2026-08-30T18:30:00.000Z');

/**
 * What the driver hands back, including the scale it drops: a stored `2000.50`
 * arrives as `2000.5`, which is the defect PC3 measured and every money
 * projection in this repository converts against.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    startTime: START,
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
        // `businessName`, not `name` — the column BusinessProfile actually has.
        // The first version of this fixture said `name`, the mock accepted it,
        // and every test here passed against a query the database would have
        // refused. `tsc` caught it; the assertion below is what keeps it caught.
        owner: {
          businessProfile: { businessName: 'Barbería Central', publicSlug: 'barberia-central' },
        },
      },
    },
    ...overrides,
  };
}

function createDb(found: unknown = row()) {
  const findUnique = vi.fn().mockResolvedValue(found);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = { booking: { findUnique, updateMany } } as unknown as PrismaClient;
  return { db, findUnique, updateMany };
}

describe('PrismaBookingRepository - findForConfirmationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_key_the_read_on_the_booking_id_not_on_the_token', async () => {
    // Arrange: its callers already hold the id from the transition they just
    // completed. Keying on the token would make this a second lookup a
    // stranger's input could reach.
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: BOOKING } }));
  });

  it('should_name_its_columns_rather_than_selecting_the_whole_row', async () => {
    // Arrange
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.findForConfirmationEmail(BOOKING);

    // Assert
    const args = findUnique.mock.calls[0][0];
    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
  });

  it('should_select_the_client_email_which_is_the_point_of_this_projection', async () => {
    // Arrange: the one read in the public flow that deliberately carries it.
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.findForConfirmationEmail(BOOKING);

    // Assert
    const args = findUnique.mock.calls[0][0];
    expect(args.select.client.select.email).toBe(true);
  });

  it('should_select_the_brand_by_the_column_name_that_exists', async () => {
    // Arrange: a mock will happily return a column the schema does not have,
    // which is T58 in one line. The select is asserted by name so this suite
    // cannot certify a query the database would refuse.
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.findForConfirmationEmail(BOOKING);

    // Assert
    const profileSelect =
      findUnique.mock.calls[0][0].select.barber.select.location.select.owner.select.businessProfile
        .select;
    expect(profileSelect.businessName).toBe(true);
    expect(profileSelect.name).toBeUndefined();
  });

  it('should_not_select_the_client_phone', async () => {
    // Arrange: nothing in the message needs it, and a shape that cannot hold
    // it cannot render it.
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    const args = findUnique.mock.calls[0][0];
    expect(args.select.client.select.phone).toBeUndefined();
    expect(Object.keys(result ?? {})).not.toContain('clientPhone');
  });

  it('should_carry_no_payment_configuration_column_of_any_kind', async () => {
    // Arrange: nothing on the way to an email may become a second holder of an
    // access token.
    const { db, findUnique } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.findForConfirmationEmail(BOOKING);

    // Assert
    const serialized = JSON.stringify(findUnique.mock.calls[0][0]);
    expect(serialized).not.toContain('paymentConfig');
    expect(serialized).not.toContain('mpAccessToken');
    expect(serialized).not.toContain('mpPublicKey');
  });

  it('should_convert_both_money_columns_to_canonical_strings', async () => {
    // Arrange: the driver returned "2000.5" for a stored 2000.50.
    const { db } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(result?.depositAmount).toBe('2000.50');
    expect(result?.priceAtBooking).toBe('9000.00');
  });

  it('should_map_the_shop_the_branch_the_barber_and_the_service', async () => {
    // Arrange
    const { db } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(result).toMatchObject({
      clientName: 'Ana Pérez',
      clientEmail: 'ana@example.com',
      shopName: 'Barbería Central',
      shopSlug: 'barberia-central',
      locationName: 'Sucursal Palermo',
      locationAddress: 'Gorriti 4500',
      barberName: 'Nico',
      serviceName: 'Corte y barba',
      startTime: START,
      cancellationToken: 'tok-abc123',
    });
  });

  it('should_return_null_when_the_booking_does_not_exist', async () => {
    // Arrange
    const { db } = createDb(null);
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(result).toBeNull();
  });

  it('should_return_null_when_the_shop_has_no_public_profile', async () => {
    // Arrange: the same rule the payment projections apply — a shop with no
    // profile has no address the link could be built from.
    const found = row();
    found.barber.location.owner = { businessProfile: null } as never;
    const { db } = createDb(found);
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(result).toBeNull();
  });

  it('should_carry_a_null_address_when_the_branch_has_none', async () => {
    // Arrange
    const found = row();
    found.barber.location.address = null as never;
    const { db } = createDb(found);
    const repository = new PrismaBookingRepository(db);

    // Act
    const result = await repository.findForConfirmationEmail(BOOKING);

    // Assert
    expect(result?.locationAddress).toBeNull();
  });
});

describe('PrismaBookingRepository - markConfirmationEmailSent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_write_exactly_one_column', async () => {
    // Arrange
    const { db, updateMany } = createDb();
    const repository = new PrismaBookingRepository(db);
    const sentAt = new Date('2026-08-25T12:00:00.000Z');

    // Act
    await repository.markConfirmationEmailSent(BOOKING, sentAt);

    // Assert
    const args = updateMany.mock.calls[0][0];
    expect(Object.keys(args.data)).toEqual(['confirmationEmailSentAt']);
    expect(args.data.confirmationEmailSentAt).toBe(sentAt);
  });

  it('should_key_the_write_on_the_booking_id', async () => {
    // Arrange
    const { db, updateMany } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.markConfirmationEmailSent(BOOKING, new Date());

    // Assert
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: BOOKING });
  });

  it('should_touch_no_status_hold_or_snapshot_column', async () => {
    // Arrange: a bookkeeping write must not be able to change what a booking is.
    const { db, updateMany } = createDb();
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.markConfirmationEmailSent(BOOKING, new Date());

    // Assert
    const data = JSON.stringify(updateMany.mock.calls[0][0].data);
    for (const forbidden of [
      'status',
      'holdExpiresAt',
      'cancelledAt',
      'cancelledBy',
      'priceAtBooking',
      'depositAmount',
      'startTime',
      'endTime',
    ]) {
      expect(data).not.toContain(forbidden);
    }
  });

  it('should_not_run_inside_a_transaction', async () => {
    // Arrange: it follows a committed transition and must never rejoin one.
    const transaction = vi.fn();
    const { db, updateMany } = createDb();
    (db as unknown as { $transaction: unknown }).$transaction = transaction;
    const repository = new PrismaBookingRepository(db);

    // Act
    await repository.markConfirmationEmailSent(BOOKING, new Date());

    // Assert
    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
