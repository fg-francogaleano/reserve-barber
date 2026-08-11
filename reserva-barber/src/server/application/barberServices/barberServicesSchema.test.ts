import { describe, it, expect } from 'vitest';
import { parseSetBarberServices } from './barberServicesSchema';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';

const BARBER = 'barber-1';

function ids(count: number, prefix = 'svc'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe('parseSetBarberServices - barberId', () => {
  it('should_reject_a_missing_barberId', () => {
    const result = parseSetBarberServices({
      serviceIds: ['svc-1'],
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.barberId).toBe('required');
  });

  it('should_reject_a_blank_barberId', () => {
    const result = parseSetBarberServices({
      barberId: '   ',
      serviceIds: [],
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.barberId).toBe('required');
  });
});

describe('parseSetBarberServices - selection shape', () => {
  it('should_deduplicate_repeated_ids', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: ['svc-1', 'svc-1', 'svc-2'],
      renderedServiceIds: ['svc-1', 'svc-2'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.serviceIds).toEqual(['svc-1', 'svc-2']);
  });

  it('should_reject_a_non_string_entry', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: ['svc-1', 42],
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.serviceIds).toBe('invalid');
  });

  it('should_reject_more_ids_than_the_owner_cap_allows', () => {
    const oversized = ids(MAX_SERVICES_PER_OWNER + 1);
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: oversized,
      renderedServiceIds: oversized,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.serviceIds).toBe('too_many');
  });

  it('should_accept_exactly_the_cap', () => {
    const atCap = ids(MAX_SERVICES_PER_OWNER);
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: atCap,
      renderedServiceIds: atCap,
    });

    expect(result.ok).toBe(true);
  });

  it('should_count_duplicates_once_against_the_cap', () => {
    const atCap = ids(MAX_SERVICES_PER_OWNER);
    const result = parseSetBarberServices({
      barberId: BARBER,
      // One id repeated: the raw list exceeds the cap, the deduplicated set does not.
      serviceIds: [...atCap, atCap[0]],
      renderedServiceIds: atCap,
    });

    expect(result.ok).toBe(true);
  });

  it('should_reject_an_oversized_rendered_baseline', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: ids(MAX_SERVICES_PER_OWNER + 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.renderedServiceIds).toBe('too_many');
  });
});

describe('parseSetBarberServices - the rendered baseline is the proof of submission', () => {
  it('should_accept_an_empty_selection_as_unassign_everything', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      // An all-unchecked form omits the key entirely — this is the real payload.
      renderedServiceIds: ['svc-1', 'svc-2'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.serviceIds).toEqual([]);
      expect(result.data.renderedServiceIds).toEqual(['svc-1', 'svc-2']);
    }
  });

  it('should_reject_a_submission_with_no_rendered_baseline', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.renderedServiceIds).toBe('required');
  });

  it('should_reject_a_checked_id_that_was_never_rendered', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: ['svc-1', 'svc-9'],
      renderedServiceIds: ['svc-1', 'svc-2'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.serviceIds).toBe('invalid');
  });
});

describe('parseSetBarberServices - malformed payloads', () => {
  it('should_reject_a_selection_that_is_not_a_list', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: 'svc-1',
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.serviceIds).toBe('invalid');
  });

  it('should_reject_a_baseline_that_is_not_a_list', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: 'svc-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.renderedServiceIds).toBe('invalid');
  });

  it('should_reject_a_blank_entry_rather_than_silently_dropping_it', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: ['svc-1', '   '],
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.serviceIds).toBe('invalid');
  });

  it('should_reject_a_non_string_entry_in_the_baseline', () => {
    const result = parseSetBarberServices({
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: ['svc-1', { id: 'svc-2' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.renderedServiceIds).toBe('invalid');
  });

  it('should_trim_surrounding_whitespace_on_an_id', () => {
    const result = parseSetBarberServices({
      barberId: `  ${BARBER}  `,
      serviceIds: ['  svc-1  '],
      renderedServiceIds: ['svc-1'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.barberId).toBe(BARBER);
      expect(result.data.serviceIds).toEqual(['svc-1']);
    }
  });
});
