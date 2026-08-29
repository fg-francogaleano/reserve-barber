import { describe, it, expect } from 'vitest';
import {
  CHART_VIEWBOX,
  RANKING_VIEWBOX,
  barsFor,
  hourColumnsFor,
  labelStrideFor,
  rankingBarsFor,
  rankingHeightFor,
  sharesFor,
} from './chartGeometry';
import type { RankedEntry } from '@/server/domain/models/statistics';

/**
 * The chart's arithmetic, with no React and no DOM in sight.
 *
 * **This is the half of a hand-rolled chart that can actually be wrong.** A
 * library would have hidden this arithmetic behind an API; writing it means
 * owning it, and owning it means testing it — which is cheap here precisely
 * because these are pure functions from numbers to numbers. The rendering that
 * consumes them is asserted separately, against the DOM.
 *
 * Every value in is a canonical decimal string, because that is what crosses the
 * repository boundary and a chart is not a reason to start rounding money
 * through a float.
 */

function bucket(total: string, hour: number) {
  return { start: new Date(Date.UTC(2026, 7, 20, hour)), total };
}

describe('barsFor - the value-to-height scale', () => {
  it('should_not_divide_by_zero_when_the_period_earned_nothing', () => {
    // The state a quiet period is *supposed* to reach, and the one that turns a
    // chart into NaN coordinates and an invisible SVG.
    const bars = barsFor([bucket('0.00', 0), bucket('0.00', 1)]);

    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(Number.isFinite(bar.height)).toBe(true);
      expect(bar.height).toBe(0);
    }
  });

  it('should_give_the_largest_bucket_the_full_plot_height', () => {
    const bars = barsFor([bucket('0.00', 0), bucket('100.00', 1), bucket('50.00', 2)]);

    expect(bars[1]?.height).toBe(CHART_VIEWBOX.plotHeight);
    expect(bars[2]?.height).toBe(CHART_VIEWBOX.plotHeight / 2);
  });

  it('should_keep_every_coordinate_inside_the_viewbox', () => {
    // The chart scales to its container through the viewBox, so anything
    // outside it is drawn outside the card — the T18 family of defect, on a
    // surface that has no horizontal scroll.
    const bars = barsFor(Array.from({ length: 31 }, (_, index) => bucket(`${index * 137}.00`, 0)));

    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(CHART_VIEWBOX.width);
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(CHART_VIEWBOX.height);
    }
  });

  it('should_produce_a_valid_bar_for_a_single_bucket_period', () => {
    const bars = barsFor([bucket('4500.00', 0)]);

    expect(bars).toHaveLength(1);
    expect(bars[0]?.width).toBeGreaterThan(0);
    expect(bars[0]?.height).toBe(CHART_VIEWBOX.plotHeight);
  });

  it('should_return_nothing_for_an_empty_series_rather_than_throwing', () => {
    expect(barsFor([])).toEqual([]);
  });

  it('should_sit_every_bar_on_the_same_baseline', () => {
    const bars = barsFor([bucket('10.00', 0), bucket('90.00', 1), bucket('0.00', 2)]);

    for (const bar of bars) {
      expect(bar.y + bar.height).toBeCloseTo(CHART_VIEWBOX.plotHeight, 6);
    }
  });

  /**
   * **This test used to be called "reads money as integer cents rather than as
   * a float", and it could not have failed for that reason.**
   *
   * Found by the change's own adversarial pass, which is the discipline this
   * capability's gate requirement spells out: a bar's height is a *ratio*, and
   * `Number('0.10') / Number('0.30')` and `10 / 30` are the same number. The
   * assertion would have held with `toCents` deleted, so it was proving the
   * scale and claiming to prove the money convention.
   *
   * What it actually proves is worth keeping — that a value with two decimals
   * scales exactly — so it kept the assertions and lost the claim. The integer-
   * cent rule is load-bearing where amounts are **added** (`sumAmounts`) and is
   * tested there, over `1000.25 + 2000.25`, where a float genuinely diverges.
   */
  it('should_scale_a_two_decimal_amount_exactly', () => {
    const bars = barsFor([bucket('0.10', 0), bucket('0.20', 1), bucket('0.30', 2)]);

    expect(bars[0]?.height).toBeCloseTo(CHART_VIEWBOX.plotHeight / 3, 6);
    expect(bars[1]?.height).toBeCloseTo((CHART_VIEWBOX.plotHeight * 2) / 3, 6);
  });
});

describe('labelStrideFor - a 31-bucket axis on a narrow phone', () => {
  it('should_label_every_bucket_when_there_are_few', () => {
    expect(labelStrideFor(7)).toBe(1);
  });

  it('should_thin_the_labels_out_rather_than_let_them_overlap', () => {
    // Thirty-one labels at this width collide into an unreadable smear. The
    // alternative considered was rotating them, which costs vertical space the
    // card does not have.
    expect(labelStrideFor(31)).toBeGreaterThan(1);
    expect(labelStrideFor(24)).toBeGreaterThan(1);
  });

  it('should_always_label_the_first_bucket', () => {
    for (const count of [1, 7, 24, 28, 31]) {
      expect(0 % labelStrideFor(count)).toBe(0);
    }
  });

  it('should_never_return_a_stride_that_would_hide_every_label', () => {
    for (const count of [0, 1, 7, 24, 31]) {
      expect(labelStrideFor(count)).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(labelStrideFor(count))).toBe(true);
    }
  });
});

describe('sharesFor - the method split as proportions', () => {
  it('should_give_each_part_its_fraction_of_the_total', () => {
    const shares = sharesFor([
      { method: 'MERCADO_PAGO', total: '750.00', payments: 3 },
      { method: 'BANK_TRANSFER', total: '250.00', payments: 1 },
    ]);

    expect(shares[0]?.fraction).toBeCloseTo(0.75, 6);
    expect(shares[1]?.fraction).toBeCloseTo(0.25, 6);
  });

  it('should_lay_the_parts_end_to_end_covering_the_whole_bar', () => {
    const shares = sharesFor([
      { method: 'MERCADO_PAGO', total: '750.00', payments: 3 },
      { method: 'BANK_TRANSFER', total: '250.00', payments: 1 },
    ]);

    expect(shares[0]?.offset).toBe(0);
    expect(shares[1]?.offset).toBeCloseTo(0.75, 6);
    const last = shares[shares.length - 1];
    expect((last?.offset ?? 0) + (last?.fraction ?? 0)).toBeCloseTo(1, 6);
  });

  it('should_not_divide_by_zero_when_every_part_is_zero', () => {
    // Reachable: a period whose appointments collected nothing still has method
    // rows if a payment of 0 ever existed, and a guard is cheaper than proving
    // it cannot.
    const shares = sharesFor([{ method: 'MERCADO_PAGO', total: '0.00', payments: 0 }]);

    for (const share of shares) {
      expect(Number.isFinite(share.fraction)).toBe(true);
    }
  });

  it('should_return_nothing_for_an_empty_split', () => {
    expect(sharesFor([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D7 — the ranking bars and the hour-of-day columns
// ---------------------------------------------------------------------------

function ranked(label: string, count: number): RankedEntry {
  return { key: label, label, sublabel: null, count, share: 0, isAggregate: false };
}

describe('chartGeometry - the ranking bars', () => {
  it('should_fill_the_plot_with_the_longest_bar', () => {
    const bars = rankingBarsFor([ranked('Corte', 8), ranked('Barba', 4)]);

    expect(bars[0]?.width).toBe(RANKING_VIEWBOX.plotWidth);
    expect(bars[1]?.width).toBe(RANKING_VIEWBOX.plotWidth / 2);
  });

  it('should_draw_zero_width_bars_rather_than_NaN_when_nothing_was_booked', () => {
    // Reachable: a ranking whose every entry is zero cannot come from a
    // confirmed row set, but dividing by a zero peak would turn any future
    // caller's answer into an invisible chart full of NaN attributes.
    const bars = rankingBarsFor([ranked('Corte', 0), ranked('Barba', 0)]);

    expect(bars.every((bar) => bar.width === 0)).toBe(true);
    expect(bars.every((bar) => Number.isFinite(bar.y))).toBe(true);
  });

  it('should_lay_the_rows_out_without_overlapping', () => {
    const bars = rankingBarsFor([ranked('A', 3), ranked('B', 2), ranked('C', 1)]);

    for (let index = 1; index < bars.length; index += 1) {
      const previous = bars[index - 1]!;
      const current = bars[index]!;
      expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height);
    }
  });

  it('should_keep_every_bar_inside_the_viewbox', () => {
    const bars = rankingBarsFor(
      Array.from({ length: 9 }, (_, index) => ranked('S' + index, 9 - index))
    );

    for (const bar of bars) {
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(rankingHeightFor(9));
      expect(bar.width).toBeLessThanOrEqual(RANKING_VIEWBOX.plotWidth);
    }
  });

  it('should_grow_the_viewbox_with_the_number_of_rows', () => {
    // A fixed height would squash nine rows into the space two need, which is
    // where an unreadable label comes from at 360 px.
    expect(rankingHeightFor(9)).toBeGreaterThan(rankingHeightFor(2));
  });

  it('should_draw_nothing_for_an_empty_ranking', () => {
    expect(rankingBarsFor([])).toEqual([]);
  });

  it('should_exclude_no_entry_it_was_given', () => {
    // The bars are the ranking. Whatever decides not to draw the aggregated row
    // does it by not passing it, so this function cannot silently lose a row.
    const bars = rankingBarsFor([ranked('A', 3), ranked('B', 2)]);

    expect(bars).toHaveLength(2);
  });
});

describe('chartGeometry - the hour-of-day columns', () => {
  const FLAT = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 2 }));

  it('should_draw_one_column_per_hour', () => {
    expect(hourColumnsFor(FLAT)).toHaveLength(24);
  });

  it('should_scale_the_tallest_column_to_the_plot', () => {
    const columns = hourColumnsFor([
      { hour: 0, count: 1 },
      { hour: 1, count: 4 },
    ]);

    expect(columns[1]?.height).toBe(CHART_VIEWBOX.plotHeight);
    expect(columns[0]?.height).toBe(CHART_VIEWBOX.plotHeight / 4);
  });

  it('should_draw_a_day_with_no_appointments_as_a_flat_axis_rather_than_NaN', () => {
    const columns = hourColumnsFor(Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })));

    expect(columns.every((column) => column.height === 0)).toBe(true);
    expect(columns.every((column) => Number.isFinite(column.y))).toBe(true);
  });

  it('should_lay_the_columns_out_left_to_right_without_overlapping', () => {
    const columns = hourColumnsFor(FLAT);

    for (let index = 1; index < columns.length; index += 1) {
      expect(columns[index]!.x).toBeGreaterThanOrEqual(
        columns[index - 1]!.x + columns[index - 1]!.width
      );
    }
    expect(columns[23]!.x + columns[23]!.width).toBeLessThanOrEqual(CHART_VIEWBOX.width);
  });

  it('should_thin_a_twenty_four_hour_axis_rather_than_overlapping_its_labels', () => {
    // Reused from D6 rather than reinvented: 24 buckets is exactly the case its
    // stride table was built for.
    expect(labelStrideFor(24)).toBeGreaterThan(1);
  });
});
