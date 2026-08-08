import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationService, MAX_LOCATIONS_PER_OWNER } from './LocationService';
import { Location } from '@/server/domain/models/Location';
import {
  DuplicateLocationNameError,
  LocationLimitReachedError,
  LocationNotFoundError,
} from '@/server/domain/errors/LocationErrors';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';

const OWNER = 'owner-root';

function createRepository(overrides: Partial<ILocationRepository> = {}): ILocationRepository {
  return {
    findAllByOwner: vi.fn().mockResolvedValue([]),
    findByIdForOwner: vi.fn().mockResolvedValue(null),
    countByOwner: vi.fn().mockResolvedValue(0),
    existsByOwnerAndName: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

/** Shaped like a Prisma unique-constraint failure, without importing Prisma. */
function uniqueConstraintError(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LocationService - listOwnerLocations', () => {
  it('should_return_the_owners_locations_scoped_by_owner', async () => {
    const locations = [
      new Location('loc-1', OWNER, 'Sucursal Centro', 'Av. Corrientes 1234', true),
      new Location('loc-2', OWNER, 'Sucursal Norte', null, true),
    ];
    const repository = createRepository({ findAllByOwner: vi.fn().mockResolvedValue(locations) });
    const service = new LocationService(repository);

    const result = await service.listOwnerLocations(OWNER);

    expect(result).toEqual(locations);
    expect(repository.findAllByOwner).toHaveBeenCalledWith(OWNER);
  });

  it('should_not_filter_out_inactive_locations', async () => {
    const inactive = new Location('loc-3', OWNER, 'Sucursal Cerrada', null, false);
    const repository = createRepository({ findAllByOwner: vi.fn().mockResolvedValue([inactive]) });
    const service = new LocationService(repository);

    const result = await service.listOwnerLocations(OWNER);

    expect(result).toEqual([inactive]);
  });

  it('should_return_an_empty_list_when_the_owner_has_none', async () => {
    const service = new LocationService(createRepository());

    await expect(service.listOwnerLocations(OWNER)).resolves.toEqual([]);
  });

  it('should_propagate_a_repository_failure', async () => {
    const repository = createRepository({
      findAllByOwner: vi.fn().mockRejectedValue(new Error('Database connection failed')),
    });
    const service = new LocationService(repository);

    await expect(service.listOwnerLocations(OWNER)).rejects.toThrow('Database connection failed');
  });
});

describe('LocationService - createLocation', () => {
  const input = { name: 'Sucursal Centro', address: 'Av. Corrientes 1234' };

  it('should_create_the_location_for_the_session_owner', async () => {
    const created = new Location('loc-1', OWNER, input.name, input.address, true);
    const repository = createRepository({ create: vi.fn().mockResolvedValue(created) });
    const service = new LocationService(repository);

    const result = await service.createLocation(OWNER, input);

    expect(result).toBe(created);
    expect(repository.create).toHaveBeenCalledWith(OWNER, input);
  });

  it('should_reject_a_duplicate_name_without_attempting_the_write', async () => {
    const repository = createRepository({
      existsByOwnerAndName: vi.fn().mockResolvedValue(true),
    });
    const service = new LocationService(repository);

    await expect(service.createLocation(OWNER, input)).rejects.toBeInstanceOf(
      DuplicateLocationNameError
    );
    expect(repository.existsByOwnerAndName).toHaveBeenCalledWith(OWNER, input.name, undefined);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should_translate_a_unique_constraint_violation_into_a_domain_error', async () => {
    // The pre-check passes and the database still refuses: the race the
    // constraint exists to catch (design D2).
    const repository = createRepository({
      create: vi.fn().mockRejectedValue(uniqueConstraintError()),
    });
    const service = new LocationService(repository);

    await expect(service.createLocation(OWNER, input)).rejects.toBeInstanceOf(
      DuplicateLocationNameError
    );
  });

  it('should_not_swallow_an_unrelated_repository_failure', async () => {
    const repository = createRepository({
      create: vi.fn().mockRejectedValue(new Error('Connection terminated')),
    });
    const service = new LocationService(repository);

    await expect(service.createLocation(OWNER, input)).rejects.toThrow('Connection terminated');
  });

  it('should_reject_when_the_owner_is_at_the_cap_before_any_other_query', async () => {
    const repository = createRepository({
      countByOwner: vi.fn().mockResolvedValue(MAX_LOCATIONS_PER_OWNER),
    });
    const service = new LocationService(repository);

    await expect(service.createLocation(OWNER, input)).rejects.toBeInstanceOf(
      LocationLimitReachedError
    );
    expect(repository.existsByOwnerAndName).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should_allow_creation_one_below_the_cap', async () => {
    const created = new Location('loc-1', OWNER, input.name, input.address, true);
    const repository = createRepository({
      countByOwner: vi.fn().mockResolvedValue(MAX_LOCATIONS_PER_OWNER - 1),
      create: vi.fn().mockResolvedValue(created),
    });
    const service = new LocationService(repository);

    await expect(service.createLocation(OWNER, input)).resolves.toBe(created);
  });
});

describe('LocationService - updateLocation', () => {
  const input = { id: 'loc-1', name: 'Sucursal Centro', address: 'Av. Corrientes 1234' };

  it('should_update_the_location_scoped_to_the_owner', async () => {
    const updated = new Location(input.id, OWNER, input.name, input.address, true);
    const repository = createRepository({ update: vi.fn().mockResolvedValue(updated) });
    const service = new LocationService(repository);

    const result = await service.updateLocation(OWNER, input);

    expect(result).toBe(updated);
    expect(repository.update).toHaveBeenCalledWith(input.id, OWNER, {
      name: input.name,
      address: input.address,
    });
  });

  it('should_exclude_the_edited_location_from_the_duplicate_check', async () => {
    const updated = new Location(input.id, OWNER, input.name, input.address, true);
    const repository = createRepository({ update: vi.fn().mockResolvedValue(updated) });
    const service = new LocationService(repository);

    await service.updateLocation(OWNER, input);

    expect(repository.existsByOwnerAndName).toHaveBeenCalledWith(OWNER, input.name, input.id);
  });

  it('should_reject_a_name_already_used_by_another_location', async () => {
    const repository = createRepository({
      existsByOwnerAndName: vi.fn().mockResolvedValue(true),
    });
    const service = new LocationService(repository);

    await expect(service.updateLocation(OWNER, input)).rejects.toBeInstanceOf(
      DuplicateLocationNameError
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should_raise_not_found_when_the_scoped_update_matches_no_row', async () => {
    // Zero rows can only mean an unknown id or a different owner: PostgreSQL
    // still reports an affected row when the values are unchanged (design D8).
    const repository = createRepository({ update: vi.fn().mockResolvedValue(null) });
    const service = new LocationService(repository);

    await expect(service.updateLocation(OWNER, input)).rejects.toBeInstanceOf(
      LocationNotFoundError
    );
  });

  it('should_translate_a_unique_constraint_violation_into_a_domain_error', async () => {
    const repository = createRepository({
      update: vi.fn().mockRejectedValue(uniqueConstraintError()),
    });
    const service = new LocationService(repository);

    await expect(service.updateLocation(OWNER, input)).rejects.toBeInstanceOf(
      DuplicateLocationNameError
    );
  });

  it('should_not_apply_the_cap_to_edits', async () => {
    const updated = new Location(input.id, OWNER, input.name, input.address, true);
    const repository = createRepository({
      countByOwner: vi.fn().mockResolvedValue(MAX_LOCATIONS_PER_OWNER),
      update: vi.fn().mockResolvedValue(updated),
    });
    const service = new LocationService(repository);

    await expect(service.updateLocation(OWNER, input)).resolves.toBe(updated);
  });
});

describe('LocationService - findLocationForOwner', () => {
  it('should_return_the_location_when_it_belongs_to_the_owner', async () => {
    const location = new Location('loc-1', OWNER, 'Sucursal Centro', null, true);
    const repository = createRepository({
      findByIdForOwner: vi.fn().mockResolvedValue(location),
    });
    const service = new LocationService(repository);

    await expect(service.findLocationForOwner(OWNER, 'loc-1')).resolves.toBe(location);
    expect(repository.findByIdForOwner).toHaveBeenCalledWith('loc-1', OWNER);
  });

  it('should_return_null_for_an_unknown_or_foreign_location', async () => {
    const service = new LocationService(createRepository());

    await expect(service.findLocationForOwner(OWNER, 'someone-elses-id')).resolves.toBeNull();
  });
});
