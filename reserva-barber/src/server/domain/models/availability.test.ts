import { describe, it, expect } from 'vitest';
import { generateSlots, overlaps, subtractAll, type Interval } from './availability';

/**
 * Instants on one arbitrary day. The algebra knows nothing about calendars or
 * timezones — it operates on instants — so the day is irrelevant and fixed.
 */
function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, 17, hour, minute));
}

function interval(startHour: number, endHour: number): Interval {
  return { start: at(startHour), end: at(endHour) };
}

/** Compares by value; `toEqual` on Date pairs compares instants correctly. */
function asPairs(intervals: readonly Interval[]): string[] {
  return intervals.map((i) => `${i.start.toISOString()}..${i.end.toISOString()}`);
}

describe('availability - overlap is half-open', () => {
  // The rule every consumer shares: aStart < bEnd && aEnd > bStart. The four
  // boundary cases below are the ones that decide whether an appointment
  // beginning exactly when an absence ends is bookable, and data-model.md §9
  // records what happens when two rules disagree about them.

  it('should_report_two_separated_intervals_as_not_overlapping', () => {
    expect(overlaps(interval(9, 10), interval(11, 12))).toBe(false);
  });

  it('should_not_overlap_when_one_ends_exactly_where_the_other_starts', () => {
    // 09:00–10:00 and 10:00–11:00 are adjacent, not overlapping. This is the
    // case that makes an appointment ending at an absence's start bookable.
    expect(overlaps(interval(9, 10), interval(10, 11))).toBe(false);
    expect(overlaps(interval(10, 11), interval(9, 10))).toBe(false);
  });

  it('should_overlap_when_they_share_any_interior_instant', () => {
    expect(overlaps(interval(9, 11), interval(10, 12))).toBe(true);
    expect(overlaps(interval(10, 12), interval(9, 11))).toBe(true);
  });

  it('should_overlap_when_one_contains_the_other', () => {
    expect(overlaps(interval(9, 18), interval(12, 13))).toBe(true);
    expect(overlaps(interval(12, 13), interval(9, 18))).toBe(true);
  });

  it('should_overlap_when_they_are_identical', () => {
    expect(overlaps(interval(9, 10), interval(9, 10))).toBe(true);
  });
});

describe('availability - subtracting blockers from a window', () => {
  it('should_return_the_window_untouched_when_nothing_blocks', () => {
    expect(asPairs(subtractAll(interval(9, 18), []))).toEqual(asPairs([interval(9, 18)]));
  });

  it('should_return_the_window_untouched_when_a_blocker_falls_outside_it', () => {
    const free = subtractAll(interval(9, 12), [interval(14, 16)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 12)]));
  });

  it('should_return_the_window_untouched_when_a_blocker_only_touches_its_edge', () => {
    // Adjacent, not overlapping — the half-open rule again, one layer up.
    const free = subtractAll(interval(9, 12), [interval(12, 14), interval(7, 9)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 12)]));
  });

  it('should_split_the_window_in_two_when_a_blocker_sits_inside_it', () => {
    const free = subtractAll(interval(9, 18), [interval(13, 14)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 13), interval(14, 18)]));
  });

  it('should_trim_the_front_when_a_blocker_covers_the_start', () => {
    const free = subtractAll(interval(9, 18), [interval(8, 11)]);

    expect(asPairs(free)).toEqual(asPairs([interval(11, 18)]));
  });

  it('should_trim_the_back_when_a_blocker_covers_the_end', () => {
    const free = subtractAll(interval(9, 18), [interval(16, 20)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 16)]));
  });

  it('should_return_nothing_when_a_blocker_covers_the_whole_window', () => {
    expect(subtractAll(interval(9, 18), [interval(8, 20)])).toEqual([]);
  });

  it('should_return_nothing_when_a_blocker_matches_the_window_exactly', () => {
    expect(subtractAll(interval(9, 18), [interval(9, 18)])).toEqual([]);
  });

  it('should_union_overlapping_blockers_rather_than_subtracting_twice', () => {
    // M5b permits a barber to record a week off and then an afternoon inside
    // it. data-model.md §9: "They union when availability is computed."
    const free = subtractAll(interval(9, 18), [interval(11, 15), interval(13, 14)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 11), interval(15, 18)]));
  });

  it('should_union_blockers_that_merely_touch', () => {
    const free = subtractAll(interval(9, 18), [interval(11, 13), interval(13, 15)]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 11), interval(15, 18)]));
  });

  it('should_not_depend_on_the_order_blockers_arrive_in', () => {
    const ordered = subtractAll(interval(9, 18), [interval(10, 11), interval(14, 15)]);
    const reversed = subtractAll(interval(9, 18), [interval(14, 15), interval(10, 11)]);

    expect(asPairs(reversed)).toEqual(asPairs(ordered));
  });

  it('should_produce_several_free_intervals_from_several_blockers', () => {
    const free = subtractAll(interval(9, 18), [
      interval(10, 11),
      interval(13, 14),
      interval(16, 17),
    ]);

    expect(asPairs(free)).toEqual(
      asPairs([interval(9, 10), interval(11, 13), interval(14, 16), interval(17, 18)])
    );
  });

  it('should_return_free_intervals_in_chronological_order', () => {
    const free = subtractAll(interval(9, 18), [interval(16, 17), interval(10, 11)]);

    for (let i = 1; i < free.length; i += 1) {
      expect(free[i]!.start.getTime()).toBeGreaterThanOrEqual(free[i - 1]!.end.getTime());
    }
  });

  it('should_ignore_a_zero_length_blocker', () => {
    // Not reachable through the editors — M5a rejects a zero-length window and
    // M5b a zero-length absence — but a blocker that contains no time blocks
    // nothing, and the algebra should not need the validators to hold.
    const free = subtractAll(interval(9, 18), [{ start: at(13), end: at(13) }]);

    expect(asPairs(free)).toEqual(asPairs([interval(9, 18)]));
  });

  it('should_return_nothing_for_a_zero_length_window', () => {
    expect(subtractAll({ start: at(9), end: at(9) }, [])).toEqual([]);
  });
});

/** `HH:MM` in the same fixed day, for reading a slot list at a glance. */
function asTimes(slots: readonly Date[]): string[] {
  return slots.map(
    (slot) =>
      `${String(slot.getUTCHours()).padStart(2, '0')}:${String(slot.getUTCMinutes()).padStart(2, '0')}`
  );
}

/** Long before any slot under test, so the lead time never interferes. */
const YESTERDAY = new Date(Date.UTC(2026, 7, 16, 12));

function slots(input: {
  windows: readonly Interval[];
  blockers?: readonly Interval[];
  durationMinutes: number;
  now?: Date;
  minLeadMinutes?: number;
}): string[] {
  return asTimes(
    generateSlots({
      windows: input.windows,
      blockers: input.blockers ?? [],
      durationMinutes: input.durationMinutes,
      now: input.now ?? YESTERDAY,
      minLeadMinutes: input.minLeadMinutes ?? 0,
    })
  );
}

describe('availability - the five-minute grid', () => {
  it('should_tile_a_free_window_every_five_minutes', () => {
    expect(slots({ windows: [interval(9, 10)], durationMinutes: 30 })).toEqual([
      '09:00',
      '09:05',
      '09:10',
      '09:15',
      '09:20',
      '09:25',
      '09:30',
    ]);
  });

  it('should_offer_the_last_start_that_fits_and_not_the_first_that_does_not', () => {
    const offered = slots({ windows: [interval(9, 18)], durationMinutes: 30 });

    expect(offered).toContain('17:30');
    expect(offered).not.toContain('17:35');
  });

  it('should_produce_the_dense_case_the_owner_chose', () => {
    // 9–18 with a 30-minute service. 103 starts is the ordinary case, not the
    // stress case — which is why the slot step groups by daypart (design D11).
    expect(slots({ windows: [interval(9, 18)], durationMinutes: 30 })).toHaveLength(103);
  });

  it('should_re_anchor_the_grid_after_a_booking_rather_than_keeping_the_original_offsets', () => {
    // The whole point of the five-minute grid: a 30-minute cancellation reopens
    // six positions, not one.
    const offered = slots({
      windows: [interval(9, 12)],
      blockers: [{ start: at(10), end: at(10, 30) }],
      durationMinutes: 30,
    });

    expect(offered).toContain('09:30');
    expect(offered).not.toContain('09:35');
    expect(offered).toContain('10:30');
    expect(offered).toContain('10:35');
  });

  it('should_offer_nothing_when_the_service_is_longer_than_every_gap', () => {
    expect(
      slots({
        windows: [interval(9, 18)],
        blockers: [
          { start: at(9, 45), end: at(12) },
          { start: at(12, 45), end: at(18) },
        ],
        durationMinutes: 60,
      })
    ).toEqual([]);
  });

  it('should_offer_nothing_when_the_weekday_has_no_window', () => {
    expect(slots({ windows: [], durationMinutes: 30 })).toEqual([]);
  });

  it('should_return_starts_in_chronological_order_across_windows', () => {
    const offered = slots({
      windows: [interval(16, 17), interval(9, 10)],
      durationMinutes: 60,
    });

    expect(offered).toEqual(['09:00', '16:00']);
  });
});

describe('availability - a split shift is not sold as one window', () => {
  // docs/tech-debt.md T27 names this story: "B3 must not ship assuming a single
  // window is sufficient." The editor writes one window per day today; the
  // schema permits two, and the generator must not assume the editor's shape.
  const splitShift = [interval(9, 13), interval(16, 20)];

  it('should_not_offer_any_start_inside_the_break', () => {
    const offered = slots({ windows: splitShift, durationMinutes: 30 });

    expect(offered).toContain('12:30');
    expect(offered).not.toContain('12:35');
    expect(offered).not.toContain('14:00');
    expect(offered).not.toContain('15:30');
    expect(offered).toContain('16:00');
  });

  it('should_refuse_an_appointment_that_would_span_two_windows', () => {
    const offered = slots({ windows: splitShift, durationMinutes: 60 });

    expect(offered).toContain('12:00');
    expect(offered).not.toContain('12:05');
    expect(offered).not.toContain('15:30');
    expect(offered).toContain('16:00');
  });
});

describe('availability - boundaries decide whether a day is sellable', () => {
  it('should_offer_an_appointment_ending_exactly_at_the_window_end', () => {
    expect(slots({ windows: [interval(9, 18)], durationMinutes: 30 })).toContain('17:30');
  });

  it('should_offer_a_start_exactly_when_an_absence_ends', () => {
    const offered = slots({
      windows: [interval(9, 18)],
      blockers: [{ start: at(13), end: at(16) }],
      durationMinutes: 30,
    });

    expect(offered).toContain('16:00');
  });

  it('should_offer_an_appointment_ending_exactly_when_an_absence_starts', () => {
    const offered = slots({
      windows: [interval(9, 18)],
      blockers: [{ start: at(13), end: at(16) }],
      durationMinutes: 30,
    });

    expect(offered).toContain('12:30');
  });

  it('should_not_offer_a_start_exactly_when_an_absence_starts', () => {
    const offered = slots({
      windows: [interval(9, 18)],
      blockers: [{ start: at(13), end: at(16) }],
      durationMinutes: 30,
    });

    expect(offered).not.toContain('13:00');
    expect(offered).not.toContain('12:35');
  });
});

describe('availability - the lead time', () => {
  it('should_drop_starts_inside_the_minimum_notice', () => {
    const offered = slots({
      windows: [interval(14, 18)],
      durationMinutes: 30,
      now: at(14, 30),
      minLeadMinutes: 60,
    });

    expect(offered).not.toContain('15:00');
    expect(offered).not.toContain('15:25');
    expect(offered[0]).toBe('15:30');
  });

  it('should_treat_the_cutoff_instant_itself_as_bookable', () => {
    const offered = slots({
      windows: [interval(14, 18)],
      durationMinutes: 30,
      now: at(14, 0),
      minLeadMinutes: 60,
    });

    expect(offered[0]).toBe('15:00');
  });

  it('should_offer_nothing_when_every_remaining_start_is_inside_the_notice', () => {
    // The state the slot step renders as "no quedan turnos para hoy" — an empty
    // list for a reason the client can act on, not an unexplained blank.
    expect(
      slots({
        windows: [interval(14, 16)],
        durationMinutes: 30,
        now: at(15, 45),
        minLeadMinutes: 60,
      })
    ).toEqual([]);
  });

  it('should_not_be_affected_by_the_lead_time_on_a_future_day', () => {
    expect(
      slots({
        windows: [interval(9, 10)],
        durationMinutes: 60,
        now: YESTERDAY,
        minLeadMinutes: 60,
      })
    ).toEqual(['09:00']);
  });
});
