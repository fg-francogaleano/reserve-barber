import { describe, it, expect } from 'vitest';
import { averageDepositPerBooking, STATISTICS_RANGES, type StatisticsRange } from './statistics';

describe('statistics - the average deposit per appointment', () => {
  it('should_divide_a_total_across_its_appointments', () => {
    expect(averageDepositPerBooking('9000.00', 3)).toBe('3000.00');
  });

  it('should_be_absent_when_there_are_no_appointments', () => {
    // The whole reason this returns a union rather than a string. A formatted
    // zero here is a false statement about the business and is
    // indistinguishable from a period whose appointments earned nothing.
    expect(averageDepositPerBooking('0.00', 0)).toBeNull();
    expect(averageDepositPerBooking('4500.00', 0)).toBeNull();
  });

  it('should_be_a_real_zero_when_appointments_happened_and_nothing_was_collected', () => {
    // The asymmetry with the case above, and it is deliberate: an empty
    // numerator is an answer, an empty denominator is the absence of one.
    expect(averageDepositPerBooking('0.00', 4)).toBe('0.00');
  });

  it('should_round_half_up_at_exactly_half_a_centavo', () => {
    // 300 centavos over 8 appointments is 37.5 centavos.
    expect(averageDepositPerBooking('3.00', 8)).toBe('0.38');
  });

  it('should_round_down_below_half_a_centavo', () => {
    // 299 centavos over 8 is 37.375.
    expect(averageDepositPerBooking('2.99', 8)).toBe('0.37');
  });

  it('should_round_up_above_half_a_centavo', () => {
    // 301 centavos over 8 is 37.625.
    expect(averageDepositPerBooking('3.01', 8)).toBe('0.38');
  });

  it('should_read_a_one_digit_fraction_as_tenths_not_hundredths', () => {
    // The defect PC3 measured against the live database: the driver returns a
    // stored 2000.50 as 2000.5, and reading the lone 5 as five centavos turns
    // two thousand pesos fifty into two thousand pesos five centavos.
    expect(averageDepositPerBooking('2000.5', 1)).toBe('2000.50');
  });

  it('should_survive_a_total_with_no_fraction_at_all', () => {
    expect(averageDepositPerBooking('2000', 1)).toBe('2000.00');
  });

  it('should_stay_exact_where_a_float_would_not', () => {
    // 0.1 + 0.2 arithmetic is exactly what integer cents exist to avoid.
    // 10.30 over 1 must not come back as 10.299999999999999.
    expect(averageDepositPerBooking('10.30', 1)).toBe('10.30');
    expect(averageDepositPerBooking('0.30', 3)).toBe('0.10');
  });

  it('should_not_drift_on_a_repeating_quotient', () => {
    // 1000 centavos over 3 is 333.33…, which must land on 333 and not on a
    // value carrying a binary fraction.
    expect(averageDepositPerBooking('10.00', 3)).toBe('3.33');
  });

  it('should_handle_a_sum_far_larger_than_any_single_price', () => {
    // A period's sum is not bounded by MAX_PRICE. Ten thousand appointments at
    // 4500 is 45 million pesos, which is inside Decimal(12,2) and outside
    // anything the price parser accepts.
    expect(averageDepositPerBooking('45000000.00', 10_000)).toBe('4500.00');
  });
});

describe('statistics - the range vocabulary', () => {
  it('should_offer_exactly_six_ranges', () => {
    expect(STATISTICS_RANGES).toHaveLength(6);
  });

  it('should_name_today_first_because_it_is_the_default_view', () => {
    expect(STATISTICS_RANGES[0]).toBe('hoy');
  });

  it('should_carry_no_duplicate_slug', () => {
    expect(new Set(STATISTICS_RANGES).size).toBe(STATISTICS_RANGES.length);
  });

  it('should_use_slugs_that_are_safe_in_a_url_and_in_a_comparison', () => {
    for (const slug of STATISTICS_RANGES) {
      expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it('should_derive_its_type_from_the_tuple_rather_than_restating_it', () => {
    // A compile-time assertion with a runtime body: if the union were widened
    // to `string`, this would still pass, so the value below is also checked.
    const slug: StatisticsRange = 'mes-anterior';
    expect(STATISTICS_RANGES).toContain(slug);
  });
});
