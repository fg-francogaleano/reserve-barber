import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationService } from './LocationService';
import { Location } from '@/server/domain/models/Location';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';

describe('LocationService - listActiveLocations', () => {
  let repository: ILocationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_return_locations_when_repository_has_active_locations', async () => {
    // Arrange
    const locations = [
      new Location('loc-1', 'owner-1', 'Sucursal Centro', 'Av. Corrientes 1234, CABA', true),
      new Location('loc-2', 'owner-1', 'Sucursal Norte', null, true),
    ];
    repository = { findAllActive: vi.fn().mockResolvedValue(locations) };
    const service = new LocationService(repository);

    // Act
    const result = await service.listActiveLocations();

    // Assert
    expect(result).toEqual(locations);
    expect(repository.findAllActive).toHaveBeenCalledTimes(1);
  });

  it('should_return_empty_list_when_repository_has_no_locations', async () => {
    // Arrange
    repository = { findAllActive: vi.fn().mockResolvedValue([]) };
    const service = new LocationService(repository);

    // Act
    const result = await service.listActiveLocations();

    // Assert
    expect(result).toEqual([]);
  });

  it('should_propagate_error_when_repository_fails', async () => {
    // Arrange
    const failure = new Error('Database connection failed');
    repository = { findAllActive: vi.fn().mockRejectedValue(failure) };
    const service = new LocationService(repository);

    // Act & Assert
    await expect(service.listActiveLocations()).rejects.toThrow('Database connection failed');
  });
});
