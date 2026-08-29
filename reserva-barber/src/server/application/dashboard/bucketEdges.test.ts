import { describe, it, expect } from 'vitest';
import { bucketEdgesFor, granularityFor, intervalFor } from './statisticsRangeParams';
import { STATISTICS_RANGES } from '@/server/domain/models/statistics';
import { businessToday, type LocalDate } from '@/server/domain/models/bookingCalendar';

/**
 * The bucket edges the income chart's axis is built from (D6).
 *
 * These live in their own file rather than in `statisticsRangeParams.test.ts`
 * because they are a different question about the same module: that file proves
 * which *period* a parameter resolves to, this one proves how that period is
 * *divided*. The failure modes do not overlap.
 *
 * 23:30 in Buenos Aires on Sunday 2026-08-16 is 02:30 UTC on Monday the 17th —
 * the three-hour window every evening in which the runtime's calendar has
 * already rolled over and the business's has not.
 */
const SUNDAY_NIGHT_LOCAL = new Date('2026-08-17T02:30:00.000Z');
const TODAY = businessToday(SUNDAY_NIGHT_LOCAL);

/** August 2026 has 31 days; February 2026 has 28. */
const IN_A_LONG_MONTH: LocalDate = { year: 2026, month: 8, day: 20 };
const IN_A_SHORT_MONTH: LocalDate = { year: 2026, month: 2, day: 10 };

describe('bucketEdgesFor - granularity is a property of the range', () => {
  it('should_divide_a_single_day_into_twenty_four_hours', () => {
    // Not chosen from the data. A day with four appointments and a day with
    // forty draw the same axis, which is what makes two periods comparable —
    // the only thing this page exists to let an owner do.
    expect(granularityFor('hoy')).toBe('hour');
    expect(granularityFor('ayer')).toBe('hour');
    expect(bucketEdgesFor('hoy', TODAY)).toHaveLength(25);
    expect(bucketEdgesFor('ayer', TODAY)).toHaveLength(25);
  });

  it('should_divide_a_week_into_seven_days', () => {
    expect(granularityFor('semana')).toBe('day');
    expect(granularityFor('semana-anterior')).toBe('day');
    expect(bucketEdgesFor('semana', TODAY)).toHaveLength(8);
    expect(bucketEdgesFor('semana-anterior', TODAY)).toHaveLength(8);
  });

  it('should_give_a_month_as_many_buckets_as_it_has_days', () => {
    // A hard-coded 30 drops the 31st silently and gives February two phantom
    // days — both of which draw a plausible chart.
    expect(bucketEdgesFor('mes', IN_A_LONG_MONTH)).toHaveLength(32);
    expect(bucketEdgesFor('mes', IN_A_SHORT_MONTH)).toHaveLength(29);
  });

  it('should_give_the_previous_month_its_own_length', () => {
    // March 2026 back to February: 28 buckets, not 31.
    expect(bucketEdgesFor('mes-anterior', { year: 2026, month: 3, day: 15 })).toHaveLength(29);
    expect(bucketEdgesFor('mes-anterior', { year: 2026, month: 9, day: 15 })).toHaveLength(32);
  });
});

describe('bucketEdgesFor - the edges span exactly the period they divide', () => {
  it('should_start_and_end_on_the_range_the_figures_use', () => {
    // The property that makes the chart's buckets sum to the card above it: the
    // series covers the same instants the aggregate counted, no more and no
    // less. Any drift here is money in a bar that is in no figure.
    for (const range of STATISTICS_RANGES) {
      const edges = bucketEdgesFor(range, TODAY);
      const interval = intervalFor(range, TODAY);

      expect(edges[0]?.getTime()).toBe(interval.start.getTime());
      expect(edges[edges.length - 1]?.getTime()).toBe(interval.end.getTime());
    }
  });

  it('should_be_strictly_ascending_and_contiguous', () => {
    for (const range of STATISTICS_RANGES) {
      const edges = bucketEdgesFor(range, TODAY);

      for (let index = 1; index < edges.length; index += 1) {
        expect((edges[index] as Date).getTime()).toBeGreaterThan(
          (edges[index - 1] as Date).getTime()
        );
      }
    }
  });

  it('should_leave_no_instant_of_the_period_outside_a_bucket', () => {
    // Contiguity is not enough on its own: edges could ascend and still leave a
    // gap. Every bucket's end must be the next bucket's start.
    for (const range of STATISTICS_RANGES) {
      const edges = bucketEdgesFor(range, TODAY);
      const spanned = (edges[edges.length - 1] as Date).getTime() - (edges[0] as Date).getTime();
      const summed = edges
        .slice(1)
        .reduce(
          (total, edge, index) => total + (edge.getTime() - (edges[index] as Date).getTime()),
          0
        );

      expect(summed).toBe(spanned);
    }
  });
});

describe('bucketEdgesFor - the business calendar decides, not the runtime', () => {
  it('should_derive_a_day_from_the_business_date_even_when_utc_has_rolled_over', () => {
    // 02:30 UTC on the 17th is still Sunday the 16th in Buenos Aires. The first
    // hourly edge belongs to the 16th's local midnight — 03:00 UTC — not to the
    // 17th's.
    const edges = bucketEdgesFor('hoy', TODAY);

    expect(edges[0]?.toISOString()).toBe('2026-08-16T03:00:00.000Z');
    expect(edges[24]?.toISOString()).toBe('2026-08-17T03:00:00.000Z');
  });

  it('should_compute_each_day_from_both_of_its_midnights', () => {
    // Not by adding a fixed duration. Argentina observes no daylight saving
    // today, so every bucket here is exactly an hour or exactly a day — the
    // assertion is that the arithmetic would still be right if that changed,
    // which is why the edges come from the calendar module rather than from
    // millisecond addition.
    const edges = bucketEdgesFor('mes', IN_A_LONG_MONTH);
    const firstDay = (edges[1] as Date).getTime() - (edges[0] as Date).getTime();

    expect(firstDay).toBe(24 * 60 * 60 * 1000);
    expect(edges).toHaveLength(32);
  });
});

describe('bucketEdgesFor - the edges are what SQL receives', () => {
  it('should_produce_one_more_edge_than_the_chart_has_buckets', () => {
    // The contract `fillIncomeSeries` and `width_bucket` both depend on: bucket
    // i spans [edges[i], edges[i + 1]).
    for (const range of STATISTICS_RANGES) {
      const edges = bucketEdgesFor(range, TODAY);
      expect(edges.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should_return_instants_rather_than_anything_a_statement_would_have_to_parse', () => {
    for (const range of STATISTICS_RANGES) {
      for (const edge of bucketEdgesFor(range, TODAY)) {
        expect(edge).toBeInstanceOf(Date);
        expect(Number.isNaN(edge.getTime())).toBe(false);
      }
    }
  });
});
