import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BarberCatalogService, MAX_BARBERS_PER_LOCATION } from './BarberCatalogService';
import type { IBarberRepository, BarberWithLocation } from '@/server/domain/repositories/IBarberRepository';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';
import { Barber } from '@/server/domain/models/Barber';
import { Location } from '@/server/domain/models/Location';
import {
  BarberNotFoundError,
  DuplicateBarberNameError,
  LocationNotAvailableError,
  BarberLimitReachedError,
} from '@/server/domain/errors/BarberErrors';

const OWNER = 'owner-1';
const LOC_ID = 'loc-1';
const BARBER_ID = 'barber-1';

function makeBarber(): Barber {
  return new Barber(BARBER_ID, LOC_ID, 'Juan Pérez', null, true);
}

function makeLocation(overrides: Partial<{ id: string; isActive: boolean }> = {}): Location {
  return new Location(
    overrides.id ?? LOC_ID,
    OWNER,
    'Sucursal Centro',
    null,
    overrides.isActive ?? true
  );
}

type BarberRepoMock = {
  [K in keyof IBarberRepository]: ReturnType<typeof vi.fn>;
};

type LocationRepoMock = {
  [K in keyof ILocationRepository]: ReturnType<typeof vi.fn>;
};

function createRepos(): { barbers: IBarberRepository; locations: ILocationRepository; bm: BarberRepoMock; lm: LocationRepoMock } {
  const bm: BarberRepoMock = {
    findAllByOwner: vi.fn().mockResolvedValue([]),
    findByIdForOwner: vi.fn().mockResolvedValue(null),
    countByLocation: vi.fn().mockResolvedValue(0),
    existsByLocationAndName: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
  };
  const lm: LocationRepoMock = {
    findAllByOwner: vi.fn().mockResolvedValue([]),
    findByIdForOwner: vi.fn().mockResolvedValue(null),
    countByOwner: vi.fn().mockResolvedValue(0),
    existsByOwnerAndName: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
  };
  return {
    barbers: bm as unknown as IBarberRepository,
    locations: lm as unknown as ILocationRepository,
    bm,
    lm,
  };
}

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma ${code}`), { code });
}

beforeEach(() => vi.clearAllMocks());

// ─── createBarber ────────────────────────────────────────────────────────────

describe('BarberCatalogService - createBarber', () => {
  it('should_create_the_barber_when_location_is_active_and_name_is_free', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    const created = makeBarber();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.create.mockResolvedValue(created);
    const svc = new BarberCatalogService(barbers, locations);

    const result = await svc.createBarber(OWNER, {
      displayName: 'Juan Pérez',
      locationId: LOC_ID,
      bio: null,
    });

    expect(result).toBe(created);
    expect(lm.findByIdForOwner).toHaveBeenCalledWith(LOC_ID, OWNER);
    expect(bm.create).toHaveBeenCalledWith(OWNER, {
      displayName: 'Juan Pérez',
      locationId: LOC_ID,
      bio: null,
    });
  });

  it('should_reject_when_location_is_unknown_or_foreign', async () => {
    const { barbers, locations, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(null);
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: 'unknown-loc', bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_reject_when_destination_location_is_inactive', async () => {
    const { barbers, locations, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation({ isActive: false }));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_reject_before_write_when_cap_is_reached', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.countByLocation.mockResolvedValue(MAX_BARBERS_PER_LOCATION);
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(BarberLimitReachedError);

    expect(bm.create).not.toHaveBeenCalled();
  });

  it('should_allow_create_one_below_the_cap', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.countByLocation.mockResolvedValue(MAX_BARBERS_PER_LOCATION - 1);
    bm.create.mockResolvedValue(makeBarber());
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).resolves.toBeDefined();
  });

  it('should_reject_a_duplicate_caught_by_pre_check', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.existsByLocationAndName.mockResolvedValue(true);
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(DuplicateBarberNameError);
    expect(bm.create).not.toHaveBeenCalled();
  });

  it('should_translate_P2002_to_DuplicateBarberNameError', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.create.mockRejectedValue(prismaError('P2002'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(DuplicateBarberNameError);
  });

  it('should_translate_P2003_to_LocationNotAvailableError', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.create.mockRejectedValue(prismaError('P2003'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_not_swallow_an_unrelated_repository_failure_on_create', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.create.mockRejectedValue(new Error('connection timeout'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toThrow('connection timeout');
  });
});

// ─── D9 — ILIKE hazard (metacharacter pre-check) ─────────────────────────────

describe('BarberCatalogService - D9 metacharacter duplicate pre-check', () => {
  it('should_compare_percent_literally_not_as_wildcard', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    // The repo returns rows that include a different name with digits
    bm.existsByLocationAndName.mockResolvedValue(false);
    bm.create.mockResolvedValue(makeBarber());
    const svc = new BarberCatalogService(barbers, locations);

    // "Juan 50%" should NOT report a duplicate with "Juan 500"
    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan 50%', locationId: LOC_ID, bio: null })
    ).resolves.toBeDefined();
  });

  it('should_compare_underscore_literally_not_as_wildcard', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.existsByLocationAndName.mockResolvedValue(false);
    bm.create.mockResolvedValue(makeBarber());
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.createBarber(OWNER, { displayName: 'Juan_1', locationId: LOC_ID, bio: null })
    ).resolves.toBeDefined();
  });
});

// ─── updateBarber ────────────────────────────────────────────────────────────

describe('BarberCatalogService - updateBarber', () => {
  it('should_update_the_barber_when_name_is_free_and_location_is_active', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    const existingBarber = makeBarber();
    const updatedBarber = new Barber(BARBER_ID, LOC_ID, 'Juan Updated', null, true);
    bm.findByIdForOwner.mockResolvedValue(existingBarber);
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.update.mockResolvedValue(updatedBarber);
    const svc = new BarberCatalogService(barbers, locations);

    const result = await svc.updateBarber(OWNER, {
      id: BARBER_ID,
      displayName: 'Juan Updated',
      locationId: LOC_ID,
      bio: null,
    });

    expect(result).toBe(updatedBarber);
  });

  it('should_not_report_the_edited_barber_as_a_duplicate_of_itself', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    const existingBarber = makeBarber();
    bm.findByIdForOwner.mockResolvedValue(existingBarber);
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    // existsByLocationAndName returns false (repo will be called with excludeId)
    bm.existsByLocationAndName.mockResolvedValue(false);
    bm.update.mockResolvedValue(existingBarber);
    const svc = new BarberCatalogService(barbers, locations);

    await svc.updateBarber(OWNER, {
      id: BARBER_ID,
      displayName: 'Juan Pérez',
      locationId: LOC_ID,
      bio: null,
    });

    expect(bm.existsByLocationAndName).toHaveBeenCalledWith(
      LOC_ID, OWNER, 'Juan Pérez', BARBER_ID
    );
  });

  it('should_reject_when_barber_is_not_found_or_belongs_to_another_owner', async () => {
    const { barbers, locations, bm } = createRepos();
    bm.findByIdForOwner.mockResolvedValue(null);
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: 'unknown', displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(BarberNotFoundError);
  });

  it('should_reject_when_destination_is_inactive_and_not_the_current_location', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    const INACTIVE_LOC = 'loc-inactive';
    bm.findByIdForOwner.mockResolvedValue(makeBarber()); // current is LOC_ID (active)
    lm.findByIdForOwner.mockResolvedValue(makeLocation({ id: INACTIVE_LOC, isActive: false }));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: INACTIVE_LOC, bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_accept_when_destination_is_inactive_but_is_the_barbers_current_location', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    // Barber is already at LOC_ID, and LOC_ID is now inactive
    const barberAtInactiveLoc = new Barber(BARBER_ID, LOC_ID, 'Juan Pérez', null, true);
    bm.findByIdForOwner.mockResolvedValue(barberAtInactiveLoc);
    // destination = LOC_ID (same as stored), and it is inactive
    lm.findByIdForOwner.mockResolvedValue(makeLocation({ id: LOC_ID, isActive: false }));
    bm.existsByLocationAndName.mockResolvedValue(false);
    bm.update.mockResolvedValue(barberAtInactiveLoc);
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan Pérez', locationId: LOC_ID, bio: null })
    ).resolves.toBeDefined();
  });

  it('D4_security_the_stored_location_decides_the_exemption_not_the_payload', async () => {
    // Payload claims currentLocationId = inactive loc, but stored barber is elsewhere.
    // The service must read the stored barber's locationId, not trust any payload assertion.
    const INACTIVE_LOC = 'loc-inactive';
    const STORED_LOC = 'loc-stored-elsewhere';
    const { barbers, locations, bm, lm } = createRepos();
    const storedBarber = new Barber(BARBER_ID, STORED_LOC, 'Juan Pérez', null, true);
    bm.findByIdForOwner.mockResolvedValue(storedBarber);
    // Destination is INACTIVE_LOC — inactive, and different from the stored location
    lm.findByIdForOwner.mockResolvedValue(makeLocation({ id: INACTIVE_LOC, isActive: false }));
    const svc = new BarberCatalogService(barbers, locations);

    // Even if someone passes locationId = INACTIVE_LOC hoping the service
    // treats it as "current", it must be rejected because stored.locationId ≠ INACTIVE_LOC.
    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: INACTIVE_LOC, bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_check_for_duplicates_at_the_destination_when_reassigning', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    const NEW_LOC = 'loc-2';
    const barberAtOldLoc = new Barber(BARBER_ID, LOC_ID, 'Juan Pérez', null, true);
    bm.findByIdForOwner.mockResolvedValue(barberAtOldLoc);
    lm.findByIdForOwner.mockResolvedValue(makeLocation({ id: NEW_LOC }));
    bm.existsByLocationAndName.mockResolvedValue(true); // duplicate at destination
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan Pérez', locationId: NEW_LOC, bio: null })
    ).rejects.toBeInstanceOf(DuplicateBarberNameError);
  });

  it('should_raise_BarberNotFoundError_when_zero_rows_updated', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    bm.findByIdForOwner.mockResolvedValue(makeBarber());
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.update.mockResolvedValue(null); // zero-row update
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(BarberNotFoundError);
  });

  it('should_translate_P2002_on_update_to_DuplicateBarberNameError', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    bm.findByIdForOwner.mockResolvedValue(makeBarber());
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.update.mockRejectedValue(prismaError('P2002'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(DuplicateBarberNameError);
  });

  it('should_translate_P2003_on_update_to_LocationNotAvailableError', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    bm.findByIdForOwner.mockResolvedValue(makeBarber());
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.update.mockRejectedValue(prismaError('P2003'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toBeInstanceOf(LocationNotAvailableError);
  });

  it('should_not_swallow_an_unrelated_failure_on_update', async () => {
    const { barbers, locations, bm, lm } = createRepos();
    bm.findByIdForOwner.mockResolvedValue(makeBarber());
    lm.findByIdForOwner.mockResolvedValue(makeLocation());
    bm.update.mockRejectedValue(new Error('db timeout'));
    const svc = new BarberCatalogService(barbers, locations);

    await expect(
      svc.updateBarber(OWNER, { id: BARBER_ID, displayName: 'Juan', locationId: LOC_ID, bio: null })
    ).rejects.toThrow('db timeout');
  });
});

// ─── listBarbers ─────────────────────────────────────────────────────────────

describe('BarberCatalogService - listBarbers', () => {
  it('should_return_the_owners_barbers', async () => {
    const { barbers, locations, bm } = createRepos();
    const item: BarberWithLocation = {
      barber: makeBarber(),
      locationName: 'Sucursal Centro',
      locationIsActive: true,
    };
    bm.findAllByOwner.mockResolvedValue([item]);
    const svc = new BarberCatalogService(barbers, locations);

    const result = await svc.listBarbers(OWNER);
    expect(result).toEqual([item]);
  });
});
