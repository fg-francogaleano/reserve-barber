import { describe, it, expect } from 'vitest';
import {
  buildBookingCatalog,
  findLocation,
  findService,
  findBarber,
  type CatalogSourceLocation,
  type PublicService,
} from './BookingCatalog';

const CORTE: PublicService = {
  id: 'svc-corte',
  name: 'Corte',
  description: 'Corte clásico',
  price: '10000.00',
  durationMinutes: 30,
};

const COLOR: PublicService = {
  id: 'svc-color',
  name: 'Color',
  description: null,
  price: '2000.50',
  durationMinutes: 60,
};

function barber(
  id: string,
  displayName: string,
  services: PublicService[]
): CatalogSourceLocation['barbers'][number] {
  return { id, displayName, bio: null, avatarUrl: null, services };
}

function location(
  id: string,
  name: string,
  barbers: CatalogSourceLocation['barbers']
): CatalogSourceLocation {
  return { id, name, address: null, barbers };
}

describe('buildBookingCatalog - the structural half of the bookability predicate', () => {
  it('should_offer_a_service_at_a_branch_where_an_active_barber_performs_it', () => {
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [CORTE])]),
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.services.map((entry) => entry.service.id)).toEqual(['svc-corte']);
    expect(catalog[0]!.services[0]!.barbers.map((b) => b.id)).toEqual(['bar-1']);
  });

  it('should_not_offer_a_branch_whose_barbers_perform_nothing', () => {
    // The barber is active and at an active branch, but holds no assignment.
    // A branch with nothing bookable is absent, not present-and-empty.
    const catalog = buildBookingCatalog([
      location('loc-norte', 'Norte', [barber('bar-2', 'Beto', [])]),
    ]);

    expect(catalog).toEqual([]);
  });

  it('should_not_offer_a_branch_with_no_barbers_at_all', () => {
    const catalog = buildBookingCatalog([location('loc-norte', 'Norte', [])]);

    expect(catalog).toEqual([]);
  });

  it('should_offer_a_service_at_one_branch_and_not_at_another', () => {
    // T23's asymmetry, and the reason the unit is the (service, location) pair.
    // A per-service answer would report "Color: bookable" and offer it at Norte,
    // where nobody performs it.
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [CORTE, COLOR])]),
      location('loc-norte', 'Norte', [barber('bar-2', 'Beto', [CORTE])]),
    ]);

    const centro = findLocation(catalog, 'loc-centro')!;
    const norte = findLocation(catalog, 'loc-norte')!;

    expect(findService(centro, 'svc-color')).toBeDefined();
    expect(findService(norte, 'svc-color')).toBeUndefined();
    expect(findService(norte, 'svc-corte')).toBeDefined();
  });

  it('should_collect_every_barber_who_performs_a_service_at_the_branch', () => {
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [
        barber('bar-1', 'Ana', [CORTE]),
        barber('bar-2', 'Beto', [CORTE]),
      ]),
    ]);

    const corte = findService(findLocation(catalog, 'loc-centro')!, 'svc-corte')!;
    expect(corte.barbers.map((b) => b.id).sort()).toEqual(['bar-1', 'bar-2']);
  });

  it('should_keep_a_service_bookable_while_one_of_its_barbers_remains', () => {
    // The query has already dropped the inactive barber; what reaches here is
    // the survivor. The service stays, with a shorter barber list.
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [CORTE])]),
    ]);

    expect(findService(findLocation(catalog, 'loc-centro')!, 'svc-corte')!.barbers).toHaveLength(1);
  });

  it('should_order_locations_services_and_barbers_deterministically', () => {
    const catalog = buildBookingCatalog([
      location('loc-norte', 'Norte', [barber('bar-3', 'Zoe', [CORTE])]),
      location('loc-centro', 'Centro', [
        barber('bar-2', 'Beto', [CORTE, COLOR]),
        barber('bar-1', 'Ana', [CORTE, COLOR]),
      ]),
    ]);

    expect(catalog.map((entry) => entry.location.name)).toEqual(['Centro', 'Norte']);
    expect(catalog[0]!.services.map((entry) => entry.service.name)).toEqual(['Color', 'Corte']);
    expect(catalog[0]!.services[0]!.barbers.map((b) => b.displayName)).toEqual(['Ana', 'Beto']);
  });

  it('should_carry_the_price_as_a_canonical_two_decimal_string', () => {
    // The `.50` case PC3 measured against the live database. Nothing in this
    // function may turn it into a number.
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [COLOR])]),
    ]);

    const color = findService(findLocation(catalog, 'loc-centro')!, 'svc-color')!;
    expect(color.service.price).toBe('2000.50');
    expect(typeof color.service.price).toBe('string');
  });

  it('should_publish_no_owner_id_activity_flag_or_timestamp', () => {
    const catalog = buildBookingCatalog([
      location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [CORTE])]),
    ]);

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('ownerId');
    expect(serialized).not.toContain('isActive');
    expect(serialized).not.toContain('createdAt');
    expect(serialized).not.toContain('updatedAt');
  });

  it('should_return_an_empty_catalog_for_a_shop_with_nothing_configured', () => {
    expect(buildBookingCatalog([])).toEqual([]);
  });
});

describe('BookingCatalog lookups', () => {
  const CATALOG = buildBookingCatalog([
    location('loc-centro', 'Centro', [barber('bar-1', 'Ana', [CORTE])]),
  ]);

  it('should_not_find_a_location_that_is_not_bookable', () => {
    expect(findLocation(CATALOG, 'loc-desconocida')).toBeUndefined();
  });

  it('should_not_find_a_service_outside_the_chosen_branch', () => {
    expect(findService(findLocation(CATALOG, 'loc-centro')!, 'svc-color')).toBeUndefined();
  });

  it('should_not_find_a_barber_who_does_not_perform_the_chosen_service', () => {
    const corte = findService(findLocation(CATALOG, 'loc-centro')!, 'svc-corte')!;
    expect(findBarber(corte, 'bar-9')).toBeUndefined();
  });
});
