import { describe, it, expect } from 'vitest';
import {
  averageDepositPerBooking,
  disambiguateLabels,
  fillHourlyDistribution,
  fillIncomeSeries,
  paymentMethodSplit,
  rankTopN,
  sumAmounts,
  sumIncomeSeries,
  STATISTICS_RANGES,
  type BreakdownEntry,
  type IncomeByBucketAndMethod,
  type StatisticsRange,
} from './statistics';
import { PAYMENT_METHODS, type PaymentMethod } from './Payment';
import { hourEdgesBetween } from './bookingCalendar';

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

// ---------------------------------------------------------------------------
// D7 — the rankings, the hour-of-day distribution, and what ties them to the
// figure above them
// ---------------------------------------------------------------------------

/** A ranking entry as the repository hands it over, before anything is ordered. */
function entry(label: string, count: number, sublabel: string | null = null): BreakdownEntry {
  return { key: label.toLowerCase(), label, sublabel, count };
}

describe('statistics - ranking a breakdown', () => {
  it('should_order_by_count_descending', () => {
    const ranked = rankTopN([entry('Corte', 2), entry('Barba', 7), entry('Color', 4)], 8);

    expect(ranked.map((row) => row.label)).toEqual(['Barba', 'Color', 'Corte']);
  });

  it('should_break_a_tie_on_the_label_ascending_rather_than_on_row_order', () => {
    // Without an explicit tie-break the statement's row order decides, and it is
    // free to differ between two renders of the same period — the owner would
    // see the ranking change while nothing changed.
    const arrived = [entry('Corte', 4), entry('Barba', 4), entry('Afeitado', 4)];

    expect(rankTopN(arrived, 8).map((row) => row.label)).toEqual(['Afeitado', 'Barba', 'Corte']);
    expect(rankTopN([...arrived].reverse(), 8).map((row) => row.label)).toEqual([
      'Afeitado',
      'Barba',
      'Corte',
    ]);
  });

  it('should_fold_everything_past_the_limit_into_one_aggregated_entry', () => {
    const many = Array.from({ length: 12 }, (_, index) => entry('S' + index, 12 - index));
    const ranked = rankTopN(many, 8);

    expect(ranked).toHaveLength(9);
    expect(ranked.slice(0, 8).every((row) => row.isAggregate === false)).toBe(true);
    expect(ranked[8]?.isAggregate).toBe(true);
    // 4 + 3 + 2 + 1 — the four that did not make the cut.
    expect(ranked[8]?.count).toBe(10);
  });

  it('should_preserve_the_total_through_the_fold', () => {
    // The post-condition, and the reason the fold is here rather than a LIMIT in
    // the statement: a discarded remainder is invisible and silently breaks the
    // reconciliation the ranking is required to satisfy.
    const many = Array.from({ length: 30 }, (_, index) => entry('S' + index, index + 1));
    const total = many.reduce((sum, row) => sum + row.count, 0);

    for (const limit of [1, 3, 8, 29, 30, 31]) {
      const ranked = rankTopN(many, limit);
      expect(ranked.reduce((sum, row) => sum + row.count, 0)).toBe(total);
    }
  });

  it('should_not_add_an_aggregate_when_nothing_was_left_over', () => {
    const ranked = rankTopN([entry('Corte', 3), entry('Barba', 1)], 8);

    expect(ranked).toHaveLength(2);
    expect(ranked.some((row) => row.isAggregate)).toBe(false);
  });

  it('should_carry_no_name_on_the_aggregated_entry', () => {
    const ranked = rankTopN([entry('Corte', 3), entry('Barba', 2), entry('Color', 1)], 2);
    const aggregate = ranked.find((row) => row.isAggregate);

    expect(aggregate?.label).toBe('');
    expect(aggregate?.sublabel).toBeNull();
  });

  it('should_compute_a_share_over_the_ranking_own_total', () => {
    const ranked = rankTopN([entry('Corte', 3), entry('Barba', 1)], 8);

    expect(ranked[0]?.share).toBe(75);
    expect(ranked[1]?.share).toBe(25);
  });

  it('should_return_nothing_for_an_empty_breakdown', () => {
    expect(rankTopN([], 8)).toEqual([]);
  });
});

describe('statistics - telling two barbers of the same name apart', () => {
  it('should_keep_the_location_on_a_label_that_repeats', () => {
    // Display names are unique per location and not across the business, so two
    // "Nico" at two branches are legal (data-model.md §5).
    const ranked = disambiguateLabels(
      rankTopN([entry('Nico', 5, 'Centro'), entry('Nico', 3, 'Norte')], 8)
    );

    expect(ranked.map((row) => row.sublabel)).toEqual(['Centro', 'Norte']);
  });

  it('should_drop_the_location_from_a_label_that_is_already_unique', () => {
    // Qualifying every row would be noise for the single-location shop that is
    // the common case.
    const ranked = disambiguateLabels(
      rankTopN([entry('Nico', 5, 'Centro'), entry('Ana', 3, 'Centro')], 8)
    );

    expect(ranked.every((row) => row.sublabel === null)).toBe(true);
  });

  it('should_qualify_only_the_labels_that_collide', () => {
    const ranked = disambiguateLabels(
      rankTopN(
        [entry('Nico', 5, 'Centro'), entry('Nico', 4, 'Norte'), entry('Ana', 3, 'Centro')],
        8
      )
    );

    expect(ranked.find((row) => row.label === 'Ana')?.sublabel).toBeNull();
    expect(ranked.filter((row) => row.label === 'Nico').map((row) => row.sublabel)).toEqual([
      'Centro',
      'Norte',
    ]);
  });

  it('should_leave_the_counts_and_the_order_untouched', () => {
    const ranked = rankTopN([entry('Nico', 5, 'Centro'), entry('Nico', 3, 'Norte')], 8);

    expect(disambiguateLabels(ranked).map((row) => row.count)).toEqual([5, 3]);
  });

  it('should_keep_the_qualifier_when_the_twin_falls_past_the_cap', () => {
    // Found by D7's second adversarial pass. Applied *after* the cut, a barber
    // whose same-named twin was folded into the aggregate loses his qualifier:
    // the name is unambiguous in the list and ambiguous in the business, and it
    // is the business the owner is reading about. Deciding it over the whole
    // set is what makes the qualifier survive the fold.
    const all = [
      entry('Nico', 20, 'Centro'),
      entry('Ana', 9, 'Centro'),
      entry('Beto', 8, 'Centro'),
      entry('Caro', 1, 'Centro'),
      entry('Nico', 1, 'Norte'),
    ];

    const beforeTheCut = rankTopN(disambiguateLabels(all), 3);
    const afterTheCut = disambiguateLabels(rankTopN(all, 3));

    expect(beforeTheCut[0]?.label).toBe('Nico');
    expect(beforeTheCut[0]?.sublabel).toBe('Centro');
    // The order this change rejected, kept as the counterfactual: it drops the
    // qualifier precisely because the twin is no longer in the list.
    expect(afterTheCut[0]?.sublabel).toBeNull();
  });

  it('should_accept_the_entries_as_read_and_not_only_a_ranking', () => {
    // The generic signature is what lets it run before `rankTopN`.
    const disambiguated = disambiguateLabels([
      entry('Nico', 5, 'Centro'),
      entry('Nico', 3, 'Norte'),
      entry('Ana', 2, 'Centro'),
    ]);

    expect(disambiguated.map((row) => row.sublabel)).toEqual(['Centro', 'Norte', null]);
  });
});

describe('statistics - the hour-of-day distribution', () => {
  // A week: 168 buckets, so hour 13 is reached seven times across the span.
  const WEEK_EDGES = hourEdgesBetween(
    { year: 2026, month: 8, day: 10 },
    { year: 2026, month: 8, day: 16 }
  );

  it('should_always_report_twenty_four_hours', () => {
    const filled = fillHourlyDistribution([{ bucket: 14, count: 3 }], WEEK_EDGES);

    expect(filled).toHaveLength(24);
    expect(filled.map((bucket) => bucket.hour)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour)
    );
  });

  it('should_draw_a_quiet_hour_as_zero_rather_than_skipping_it', () => {
    // The filling is the point and its defect is invisible: a chart that omits a
    // quiet hour draws a plausible shape on an axis that is too short.
    const filled = fillHourlyDistribution([{ bucket: 14, count: 3 }], WEEK_EDGES);

    expect(filled.filter((bucket) => bucket.count === 0)).toHaveLength(23);
  });

  it('should_fold_the_same_hour_of_different_days_together', () => {
    // Bucket 14 opens at 13:00 on Monday; bucket 38 is 13:00 on Tuesday.
    const filled = fillHourlyDistribution(
      [
        { bucket: 14, count: 3 },
        { bucket: 38, count: 2 },
      ],
      WEEK_EDGES
    );

    expect(filled[13]?.count).toBe(5);
  });

  it('should_place_a_row_in_the_business_hour_of_its_bucket_and_not_the_runtime_one', () => {
    // Bucket 22 opens at 21:00 in the business calendar, which is 00:00 UTC the
    // next day. A runtime-local reading would answer hour 0.
    const filled = fillHourlyDistribution([{ bucket: 22, count: 1 }], WEEK_EDGES);

    expect(WEEK_EDGES[21]?.toISOString()).toBe('2026-08-11T00:00:00.000Z');
    expect(filled[21]?.count).toBe(1);
    expect(filled[0]?.count).toBe(0);
  });

  it('should_drop_a_bucket_outside_the_span_rather_than_clamping_it', () => {
    // `width_bucket` answers 0 below the first threshold and n at or above the
    // last; both are unreachable while the statement carries the range
    // predicate. Clamping would move a real appointment into an hour it did not
    // happen in, so the conservative direction is to draw nothing.
    const filled = fillHourlyDistribution(
      [
        { bucket: 0, count: 9 },
        { bucket: 169, count: 9 },
        { bucket: -4, count: 9 },
      ],
      WEEK_EDGES
    );

    expect(filled.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('should_report_an_empty_axis_for_an_empty_span', () => {
    expect(fillHourlyDistribution([{ bucket: 1, count: 4 }], [])).toEqual([]);
  });
});

describe('statistics - every breakdown reconciles with the figure above it', () => {
  it('should_sum_each_breakdown_to_the_same_number_of_appointments', () => {
    // The strongest property in D7, and it is decidable here with no database:
    // it catches a payment join multiplying a retried booking, a fold losing its
    // remainder, a bucket dropped at a boundary, and an owner predicate missing
    // from one branch of the statement.
    const edges = hourEdgesBetween(
      { year: 2026, month: 8, day: 10 },
      { year: 2026, month: 8, day: 16 }
    );

    // Eleven services, so the fold is exercised rather than bypassed.
    const services = [
      entry('S0', 9),
      entry('S1', 6),
      entry('S2', 5),
      entry('S3', 4),
      entry('S4', 4),
      entry('S5', 3),
      entry('S6', 3),
      entry('S7', 2),
      entry('S8', 2),
      entry('S9', 1),
      entry('S10', 1),
    ];
    const barbers = [entry('Nico', 25, 'Centro'), entry('Ana', 15, 'Centro')];
    const hours = [
      { bucket: 14, count: 18 },
      { bucket: 38, count: 12 },
      { bucket: 111, count: 10 },
    ];
    const confirmedCount = 40;

    const total = (rows: readonly { count: number }[]) =>
      rows.reduce((sum, row) => sum + row.count, 0);

    expect(total(services)).toBe(confirmedCount);
    expect(total(rankTopN(services, 8))).toBe(confirmedCount);
    expect(total(disambiguateLabels(rankTopN(barbers, 8)))).toBe(confirmedCount);
    expect(total(fillHourlyDistribution(hours, edges))).toBe(confirmedCount);
  });
});
