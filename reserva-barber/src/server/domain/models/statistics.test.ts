import { describe, it, expect } from 'vitest';
import {
  averageDepositPerBooking,
  fillIncomeSeries,
  paymentMethodSplit,
  sumAmounts,
  sumIncomeSeries,
  STATISTICS_RANGES,
  type IncomeByBucketAndMethod,
  type StatisticsRange,
} from './statistics';
import { PAYMENT_METHODS, type PaymentMethod } from './Payment';

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

// ---------------------------------------------------------------------------
// D6 — the income series and the payment-method split
// ---------------------------------------------------------------------------

/** Four hourly edges: three buckets, `[0, 1)`, `[1, 2)`, `[2, 3)`. */
const THREE_EDGES = [
  new Date('2026-08-20T12:00:00.000Z'),
  new Date('2026-08-20T13:00:00.000Z'),
  new Date('2026-08-20T14:00:00.000Z'),
  new Date('2026-08-20T15:00:00.000Z'),
];

function row(
  bucket: number,
  method: PaymentMethod,
  total: string,
  payments: number
): IncomeByBucketAndMethod {
  return { bucket, method, total, payments };
}

describe('statistics - the income series', () => {
  it('should_fill_a_hole_in_the_middle_with_a_real_zero', () => {
    // The defect this exists to prevent is invisible: a series that simply
    // omits the quiet bucket still draws a plausible shape, on a shorter axis,
    // describing a trend that did not happen.
    const series = fillIncomeSeries([row(1, 'MERCADO_PAGO', '1000.00', 1), row(3, 'MERCADO_PAGO', '2000.00', 1)], THREE_EDGES);

    expect(series).toHaveLength(3);
    expect(series.map((bucket) => bucket.total)).toEqual(['1000.00', '0.00', '2000.00']);
  });

  it('should_fill_every_bucket_when_the_period_earned_nothing', () => {
    const series = fillIncomeSeries([], THREE_EDGES);

    expect(series).toHaveLength(3);
    expect(series.every((bucket) => bucket.total === '0.00')).toBe(true);
  });

  it('should_start_each_bucket_at_its_own_edge', () => {
    const series = fillIncomeSeries([], THREE_EDGES);

    expect(series.map((bucket) => bucket.start.toISOString())).toEqual([
      '2026-08-20T12:00:00.000Z',
      '2026-08-20T13:00:00.000Z',
      '2026-08-20T14:00:00.000Z',
    ]);
  });

  it('should_add_both_methods_into_one_bucket', () => {
    // The series is income over time, not income per method. Both rows of a
    // bucket belong to the same bar.
    const series = fillIncomeSeries(
      [row(2, 'MERCADO_PAGO', '1500.50', 1), row(2, 'BANK_TRANSFER', '2000.50', 2)],
      THREE_EDGES
    );

    expect(series[1]?.total).toBe('3501.00');
  });

  it('should_sum_to_the_period_total_the_deposits_card_reports', () => {
    // The property the spec requires and the one a chart can silently lose:
    // every bucket added together is the figure rendered directly above it.
    const series = fillIncomeSeries(
      [
        row(1, 'MERCADO_PAGO', '1000.25', 1),
        row(2, 'BANK_TRANSFER', '2000.25', 1),
        row(3, 'MERCADO_PAGO', '500.50', 1),
      ],
      THREE_EDGES
    );

    expect(sumIncomeSeries(series)).toBe('3501.00');
  });

  it('should_ignore_a_bucket_index_outside_the_edges_rather_than_throw', () => {
    // `width_bucket` answers 0 below the first threshold and n above the last.
    // The range predicate makes both unreachable, so this is a guard against a
    // future edit rather than against today's statement — and dropping the row
    // is the conservative direction: it cannot invent a bar.
    const series = fillIncomeSeries(
      [row(0, 'MERCADO_PAGO', '999.00', 1), row(9, 'MERCADO_PAGO', '999.00', 1), row(2, 'MERCADO_PAGO', '10.00', 1)],
      THREE_EDGES
    );

    expect(series.map((bucket) => bucket.total)).toEqual(['0.00', '10.00', '0.00']);
  });

  it('should_return_no_buckets_when_there_are_no_edges_to_span', () => {
    expect(fillIncomeSeries([], [])).toEqual([]);
  });
});

describe('statistics - the payment-method split', () => {
  it('should_total_each_method_across_every_bucket', () => {
    const split = paymentMethodSplit([
      row(1, 'MERCADO_PAGO', '1000.00', 1),
      row(2, 'MERCADO_PAGO', '500.50', 2),
      row(2, 'BANK_TRANSFER', '2000.00', 1),
    ]);

    expect(split).toEqual([
      { method: 'MERCADO_PAGO', total: '1500.50', payments: 3 },
      { method: 'BANK_TRANSFER', total: '2000.00', payments: 1 },
    ]);
  });

  it('should_report_only_the_methods_that_were_actually_used', () => {
    // The degenerate case, and it is the permanent state of every owner who
    // configured one payment method. A part reading zero is not a share.
    const split = paymentMethodSplit([row(1, 'BANK_TRANSFER', '2000.00', 1)]);

    expect(split).toHaveLength(1);
    expect(split[0]?.method).toBe('BANK_TRANSFER');
  });

  it('should_be_empty_when_the_period_collected_nothing', () => {
    expect(paymentMethodSplit([])).toEqual([]);
  });

  it('should_order_methods_by_the_domain_tuple_rather_than_by_the_rows', () => {
    // Otherwise the two parts swap places between periods, on a control whose
    // whole purpose is comparing one period against another.
    const split = paymentMethodSplit([
      row(1, 'BANK_TRANSFER', '1.00', 1),
      row(1, 'MERCADO_PAGO', '1.00', 1),
    ]);

    expect(split.map((part) => part.method)).toEqual([...PAYMENT_METHODS]);
  });

  it('should_sum_to_the_same_total_as_the_series', () => {
    const rows = [
      row(1, 'MERCADO_PAGO', '1000.25', 1),
      row(2, 'BANK_TRANSFER', '2000.25', 1),
      row(3, 'MERCADO_PAGO', '500.50', 1),
    ];

    expect(sumIncomeSeries(fillIncomeSeries(rows, THREE_EDGES))).toBe(
      sumAmounts(paymentMethodSplit(rows).map((part) => part.total))
    );
  });
});
