import { describe, it, expect } from 'vitest';
import { resolveBarberFilter, RECENT_FILTER_PARAM } from './recentBookingsParams';
import type { FilterableBarber } from '@/server/domain/models/dashboardSummary';

const BARBERS: readonly FilterableBarber[] = [
  { id: 'barber-nico', displayName: 'Nico' },
  { id: 'barber-ale', displayName: 'Ale' },
];

describe('recentBookingsParams - resolveBarberFilter', () => {
  it('should_resolve_a_barber_that_belongs_to_this_owner', () => {
    expect(resolveBarberFilter('barber-ale', BARBERS)).toBe('barber-ale');
  });

  it('should_discard_an_id_that_names_no_barber_of_this_owner', () => {
    // Another owner's barber and an id that never existed must be
    // indistinguishable: a differential answer would make the page an oracle
    // for "does this id exist".
    expect(resolveBarberFilter('barber-of-another-shop', BARBERS)).toBeUndefined();
    expect(resolveBarberFilter('never-existed', BARBERS)).toBeUndefined();
  });

  it('should_discard_rather_than_throw_so_the_page_renders_unfiltered', () => {
    expect(() => resolveBarberFilter('barber-of-another-shop', BARBERS)).not.toThrow();
  });

  it('should_take_the_first_occurrence_of_a_repeated_parameter', () => {
    // Next hands over an array when a parameter appears more than once.
    expect(resolveBarberFilter(['barber-nico', 'barber-ale'], BARBERS)).toBe('barber-nico');
  });

  it('should_discard_a_repeated_parameter_whose_first_value_is_unknown', () => {
    expect(resolveBarberFilter(['unknown', 'barber-ale'], BARBERS)).toBeUndefined();
  });

  it('should_treat_an_absent_or_empty_parameter_as_no_filter', () => {
    expect(resolveBarberFilter(undefined, BARBERS)).toBeUndefined();
    expect(resolveBarberFilter('', BARBERS)).toBeUndefined();
    expect(resolveBarberFilter([], BARBERS)).toBeUndefined();
  });

  it('should_refuse_an_absurd_value_before_it_is_used_for_anything', () => {
    expect(resolveBarberFilter('x'.repeat(5_000), BARBERS)).toBeUndefined();
  });

  it('should_resolve_to_nothing_when_the_owner_has_no_barbers', () => {
    expect(resolveBarberFilter('barber-nico', [])).toBeUndefined();
  });

  it('should_name_the_query_parameter_in_spanish_like_the_booking_flow', () => {
    expect(RECENT_FILTER_PARAM).toBe('barbero');
  });
});
