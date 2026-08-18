import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingCreationService, MAX_LIVE_HOLDS_PER_CLIENT } from './BookingCreationService';
import type { BookingRequestInput } from '@/server/application/booking/bookingRequestSchema';

const OWNER_ID = 'owner-root';
const SLUG = 'barberia-don-juan';

/** Local 09:00 on Monday 2026-08-17 (UTC-3). */
const SLOT = new Date('2026-08-17T12:00:00.000Z');
const NOW = new Date('2026-08-17T10:00:00.000Z');

const CATALOG = [
  {
    location: { id: 'loc-centro', name: 'Centro', address: null },
    services: [
      {
        service: {
          id: 'svc-corte',
          name: 'Corte',
          description: null,
          price: '4000.00',
          durationMinutes: 30,
        },
        barbers: [{ id: 'bar-ana', displayName: 'Ana', bio: null, avatarUrl: null }],
      },
    ],
  },
];

const READY_PAYMENTS = {
  hasMercadoPagoCredentials: true,
  transfer: { cbuCvu: null, alias: null, holderName: null },
  depositType: 'PERCENT' as const,
  depositValue: '25',
};

function input(overrides: Partial<BookingRequestInput> = {}): BookingRequestInput {
  return {
    slug: SLUG,
    locationId: 'loc-centro',
    serviceId: 'svc-corte',
    barberId: 'bar-ana',
    fecha: '2026-08-17',
    hora: '09:00',
    name: 'Ana Pérez',
    email: 'ana@mail.com',
    phone: '+5491155554444',
    ...overrides,
  };
}

function build(overrides: {
  ownerId?: string | null;
  catalog?: unknown;
  readiness?: unknown;
  slots?: Date[];
  liveHolds?: number;
  createResult?: unknown;
} = {}) {
  const profiles = {
    findOwnerIdByPublicSlug: vi
      .fn()
      .mockResolvedValue(overrides.ownerId === undefined ? OWNER_ID : overrides.ownerId),
  };
  const catalog = {
    findBookableCatalog: vi.fn().mockResolvedValue(overrides.catalog ?? CATALOG),
  };
  const payments = {
    findPaymentReadinessForPublic: vi
      .fn()
      .mockResolvedValue(overrides.readiness === undefined ? READY_PAYMENTS : overrides.readiness),
  };
  const availability = {
    slotsFor: vi.fn().mockResolvedValue(overrides.slots ?? [SLOT]),
  };
  const clients = { resolve: vi.fn().mockResolvedValue({ id: 'cli-1' }) };
  const bookings = {
    countLiveHoldsForClient: vi.fn().mockResolvedValue(overrides.liveHolds ?? 0),
    createProvisional: vi.fn().mockResolvedValue(
      overrides.createResult ?? {
        outcome: 'created',
        booking: {
          id: 'bkg-1',
          cancellationToken: 'tok-1',
          startTime: SLOT,
          endTime: new Date(SLOT.getTime() + 30 * 60_000),
          holdExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
          depositAmount: '1000.00',
        },
      }
    ),
    findByCancellationToken: vi.fn(),
  };
  const clock = { now: () => NOW.getTime() };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const service = new BookingCreationService(
    profiles as never,
    catalog as never,
    payments as never,
    availability as never,
    clients as never,
    bookings as never,
    clock as never,
    logger as never
  );

  return { service, profiles, catalog, payments, availability, clients, bookings, logger };
}

beforeEach(() => vi.clearAllMocks());

describe('BookingCreationService - refusal paths', () => {
  it('should_refuse_when_the_slug_resolves_to_no_shop', async () => {
    const { service, catalog } = build({ ownerId: null });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'selectionStale' });
    // Nothing downstream is even attempted: until an owner is resolved there
    // is nothing any id could be checked against.
    expect(catalog.findBookableCatalog).not.toHaveBeenCalled();
  });

  it('should_refuse_an_unresolvable_barber', async () => {
    const { service, bookings } = build();

    await expect(service.create(input({ barberId: 'bar-nope' }))).resolves.toEqual({
      outcome: 'selectionStale',
    });
    expect(bookings.createProvisional).not.toHaveBeenCalled();
  });

  it('should_answer_a_cross_owner_id_exactly_as_an_unknown_one', async () => {
    // A differential answer would be an existence oracle on an endpoint with
    // no session. Both ids are simply absent from this owner's catalogue.
    const { service } = build();

    const unknown = await service.create(input({ serviceId: 'svc-never-existed' }));
    const foreign = await service.create(input({ serviceId: 'svc-another-owners' }));

    expect(unknown).toEqual(foreign);
  });

  it('should_refuse_when_the_shop_has_no_payment_configuration_row', async () => {
    const { service, bookings } = build({ readiness: null });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'notPaymentReady' });
    expect(bookings.createProvisional).not.toHaveBeenCalled();
  });

  it('should_refuse_when_no_deposit_policy_is_configured', async () => {
    const { service } = build({ readiness: { ...READY_PAYMENTS, depositValue: null } });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'notPaymentReady' });
  });

  it('should_refuse_when_no_payment_method_is_configured', async () => {
    const { service } = build({
      readiness: {
        ...READY_PAYMENTS,
        hasMercadoPagoCredentials: false,
        transfer: { cbuCvu: null, alias: null, holderName: null },
      },
    });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'notPaymentReady' });
  });

  it('should_refuse_a_time_absent_from_the_regenerated_list', async () => {
    // The list the client saw is a snapshot. The write regenerates it and the
    // requested time simply is not in the new one.
    const { service, bookings } = build({ slots: [] });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'slotTaken' });
    expect(bookings.createProvisional).not.toHaveBeenCalled();
  });

  it('should_match_hora_as_a_string_rather_than_parsing_it_as_an_instant', async () => {
    const { service } = build();

    await expect(service.create(input({ hora: '2026-08-17T12:00:00.000Z' }))).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it('should_refuse_an_unparseable_date', async () => {
    const { service } = build();

    await expect(service.create(input({ fecha: '2026-02-30' }))).resolves.toEqual({
      outcome: 'selectionStale',
    });
  });

  it('should_refuse_once_the_client_has_reached_the_live_hold_cap', async () => {
    const { service, bookings } = build({ liveHolds: MAX_LIVE_HOLDS_PER_CLIENT });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'holdLimitReached' });
    expect(bookings.createProvisional).not.toHaveBeenCalled();
  });

  it('should_report_a_lost_race_as_slotTaken_rather_than_throwing', async () => {
    const { service } = build({ createResult: { outcome: 'slotTaken' } });

    await expect(service.create(input())).resolves.toEqual({ outcome: 'slotTaken' });
  });
});

describe('BookingCreationService - the deposit and the price', () => {
  it('should_derive_both_snapshots_on_the_server_from_the_shared_rule', async () => {
    // 25% of 4000.00, by the one deposit rule this project has.
    const { service, bookings } = build();

    await service.create(input());

    expect(bookings.createProvisional).toHaveBeenCalledWith(
      expect.objectContaining({ priceAtBooking: '4000.00', depositAmount: '1000.00' })
    );
  });

  it('should_ignore_a_price_or_deposit_carried_in_the_submission', async () => {
    const { service, bookings } = build();

    await service.create({
      ...input(),
      // Neither field exists on the parsed type; the schema strips them. This
      // asserts the service does not reintroduce them from a wider object.
      ...({ priceAtBooking: '1.00', depositAmount: '0.01' } as object),
    } as BookingRequestInput);

    expect(bookings.createProvisional).toHaveBeenCalledWith(
      expect.objectContaining({ priceAtBooking: '4000.00', depositAmount: '1000.00' })
    );
  });

  it('should_apply_a_fixed_policy_through_the_same_rule', async () => {
    const { service, bookings } = build({
      readiness: { ...READY_PAYMENTS, depositType: 'FIXED', depositValue: '1500.00' },
    });

    await service.create(input());

    expect(bookings.createProvisional).toHaveBeenCalledWith(
      expect.objectContaining({ depositAmount: '1500.00' })
    );
  });

  it('should_cap_a_fixed_deposit_at_the_service_price', async () => {
    // The cap is what protects a client from a policy set above a cheap
    // service's price — a save-time warning is only a snapshot of the catalogue.
    const { service, bookings } = build({
      readiness: { ...READY_PAYMENTS, depositType: 'FIXED', depositValue: '9000.00' },
    });

    await service.create(input());

    expect(bookings.createProvisional).toHaveBeenCalledWith(
      expect.objectContaining({ depositAmount: '4000.00' })
    );
  });

  it('should_clamp_the_hold_deadline_to_the_appointment_start', async () => {
    const { service, bookings } = build();

    await service.create(input());

    const call = bookings.createProvisional.mock.calls[0]?.[0];
    expect(call.holdExpiresAt.getTime()).toBeLessThanOrEqual(call.startTime.getTime());
  });
});

describe('BookingCreationService - the owner never leaves, and neither does the client', () => {
  it('should_scope_every_read_on_the_resolved_owner', async () => {
    const { service, catalog, payments, availability } = build();

    await service.create(input());

    expect(catalog.findBookableCatalog).toHaveBeenCalledWith(OWNER_ID);
    expect(payments.findPaymentReadinessForPublic).toHaveBeenCalledWith(OWNER_ID);
    expect(availability.slotsFor).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER_ID })
    );
  });

  it('should_return_no_owner_id_on_any_outcome', async () => {
    const { service } = build();

    const result = await service.create(input());

    expect(JSON.stringify(result)).not.toContain(OWNER_ID);
  });

  it('should_never_log_the_submitted_contact_details', async () => {
    // This flow is the first to hold a stranger's name, email and phone. A
    // single context object logged wholesale would publish them.
    const { service, logger } = build();

    await service.create(input());

    const everythingLogged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
      logger.debug.mock.calls,
    ]);

    expect(everythingLogged).not.toContain('ana@mail.com');
    expect(everythingLogged).not.toContain('Ana Pérez');
    expect(everythingLogged).not.toContain('5491155554444');
  });

  it('should_not_log_contact_details_on_a_refusal_either', async () => {
    const { service, logger } = build({ createResult: { outcome: 'slotTaken' } });

    await service.create(input());

    const everythingLogged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);

    expect(everythingLogged).not.toContain('ana@mail.com');
    expect(everythingLogged).not.toContain('5491155554444');
  });

  it('should_record_a_conflict_at_warning_level_so_the_rate_is_observable', async () => {
    const { service, logger } = build({ createResult: { outcome: 'slotTaken' } });

    await service.create(input());

    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('BookingCreationService - the client resolution', () => {
  it('should_pass_the_already_normalized_contact_details_through', async () => {
    const { service, clients } = build();

    await service.create(input());

    expect(clients.resolve).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      name: 'Ana Pérez',
      email: 'ana@mail.com',
      phone: '+5491155554444',
    });
  });

  it('should_return_the_clients_own_hold_unchanged_when_the_transaction_reports_one', async () => {
    const held = {
      id: 'bkg-existing',
      cancellationToken: 'tok-existing',
      startTime: SLOT,
      endTime: new Date(SLOT.getTime() + 30 * 60_000),
      holdExpiresAt: new Date(NOW.getTime() + 5 * 60_000),
      depositAmount: '1000.00',
    };
    const { service } = build({ createResult: { outcome: 'alreadyHeld', booking: held } });

    await expect(service.create(input())).resolves.toEqual({
      outcome: 'alreadyHeld',
      booking: held,
    });
  });
});
