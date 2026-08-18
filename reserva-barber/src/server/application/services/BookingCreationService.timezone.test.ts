import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The check that a runtime unable to place an instant in the business's
 * calendar refuses **before writing anything**.
 *
 * In its own file because it needs `hasTimezoneSupport` mocked at the module
 * level, and the rest of the service's tests need the real one.
 *
 * A runtime without timezone data does not throw — it silently answers UTC,
 * three hours from the business's clock. On the read side that produces a page
 * of plausible wrong times; here it would **persist** an appointment at the
 * wrong hour, and nothing downstream would ever detect it. So the assertion is
 * not "it throws", it is "it throws *and touched no repository*".
 */
const hasTimezoneSupport = vi.fn();

vi.mock('@/server/domain/models/businessTime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/domain/models/businessTime')>();
  return { ...actual, hasTimezoneSupport: () => hasTimezoneSupport() };
});

const { BookingCreationService, TimezoneUnavailableError } = await import(
  './BookingCreationService'
);

function build() {
  const profiles = { findOwnerIdByPublicSlug: vi.fn().mockResolvedValue('owner-root') };
  const catalog = { findBookableCatalog: vi.fn().mockResolvedValue([]) };
  const payments = { findPaymentReadinessForPublic: vi.fn().mockResolvedValue(null) };
  const availability = { slotsFor: vi.fn().mockResolvedValue([]) };
  const clients = { resolve: vi.fn(), findByEmail: vi.fn() };
  const bookings = {
    createProvisional: vi.fn(),
    countLiveHoldsForClient: vi.fn(),
    findLiveHoldsForClientOnDay: vi.fn(),
    findByCancellationToken: vi.fn(),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const service = new BookingCreationService(
    profiles as never,
    catalog as never,
    payments as never,
    availability as never,
    clients as never,
    bookings as never,
    { now: () => Date.now() } as never,
    logger as never
  );

  return { service, profiles, catalog, payments, availability, clients, bookings };
}

const INPUT = {
  slug: 'barberia-don-juan',
  locationId: 'loc-1',
  serviceId: 'svc-1',
  barberId: 'bar-1',
  fecha: '2026-08-19',
  hora: '10:00',
  name: 'Ana Pérez',
  email: 'ana@mail.com',
  phone: '+5491155554444',
};

beforeEach(() => vi.clearAllMocks());

describe('BookingCreationService - the timezone assertion', () => {
  it('should_refuse_when_the_runtime_cannot_place_an_instant', async () => {
    hasTimezoneSupport.mockReturnValue(false);
    const { service } = build();

    await expect(service.create(INPUT as never)).rejects.toBeInstanceOf(TimezoneUnavailableError);
  });

  it('should_refuse_before_touching_any_repository', async () => {
    // The whole point: a wrong-by-three-hours appointment must never reach the
    // database, and no read should have happened either.
    hasTimezoneSupport.mockReturnValue(false);
    const { service, profiles, catalog, payments, availability, clients, bookings } = build();

    await expect(service.create(INPUT as never)).rejects.toThrow();

    expect(profiles.findOwnerIdByPublicSlug).not.toHaveBeenCalled();
    expect(catalog.findBookableCatalog).not.toHaveBeenCalled();
    expect(payments.findPaymentReadinessForPublic).not.toHaveBeenCalled();
    expect(availability.slotsFor).not.toHaveBeenCalled();
    expect(clients.resolve).not.toHaveBeenCalled();
    expect(bookings.createProvisional).not.toHaveBeenCalled();
  });

  it('should_proceed_past_the_assertion_when_the_runtime_is_capable', async () => {
    // The negative control: without it, a check that always threw would pass
    // both tests above.
    hasTimezoneSupport.mockReturnValue(true);
    const { service, profiles } = build();

    await service.create(INPUT as never);

    expect(profiles.findOwnerIdByPublicSlug).toHaveBeenCalled();
  });
});
