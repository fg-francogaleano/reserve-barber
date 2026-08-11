import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUSINESS_UTC_OFFSET_MINUTES,
  hasTimezoneSupport,
  instantToLocal,
  localToInstant,
  minuteOfDayOf,
  offsetMinutesAt,
  weekdayOf,
} from './businessTime';

describe('businessTime - timezone support', () => {
  it('should_report_support_by_a_known_offset_not_by_absence_of_an_error', () => {
    // A runtime without tzdata does not throw — it silently reports UTC. So the
    // check must compare against a known value or it proves nothing.
    expect(hasTimezoneSupport()).toBe(true);
    expect(offsetMinutesAt(new Date('2026-01-01T12:00:00.000Z'))).toBe(
      BUSINESS_UTC_OFFSET_MINUTES
    );
  });
});

describe('businessTime - wall clock is preserved', () => {
  it('should_round_trip_a_local_time_unchanged', () => {
    const local = { year: 2026, month: 8, day: 11, minuteOfDay: 9 * 60 };

    expect(instantToLocal(localToInstant(local))).toEqual(local);
  });

  it('should_map_local_midnight_to_the_expected_instant', () => {
    const midnight = localToInstant({ year: 2026, month: 8, day: 11, minuteOfDay: 0 });

    expect(midnight.toISOString()).toBe('2026-08-11T03:00:00.000Z');
  });
});

describe('businessTime - the business calendar, not the runtime clock', () => {
  // 2026-08-10T00:30:00Z is Monday in UTC and Sunday 21:30 in Buenos Aires.
  // This is the three-hour window where getDay() is wrong every single day.
  const eveningInstant = new Date('2026-08-10T00:30:00.000Z');

  it('should_resolve_the_business_weekday_not_the_runtime_one', () => {
    expect(weekdayOf(eveningInstant)).toBe(0);
    expect(eveningInstant.getUTCDay()).toBe(1);
  });

  it('should_resolve_the_business_minute_of_day', () => {
    expect(minuteOfDayOf(eveningInstant)).toBe(21 * 60 + 30);
  });

  it('should_agree_with_the_runtime_outside_that_window', () => {
    const noon = new Date('2026-08-10T15:00:00.000Z');

    expect(weekdayOf(noon)).toBe(noon.getUTCDay());
  });
});

// ─── The ban is a convention, and conventions decay ──────────────────────────

const SCHEDULING_ROOTS = [
  join(process.cwd(), 'src', 'server', 'application', 'schedule'),
  join(process.cwd(), 'src', 'server', 'domain', 'models'),
];

/** Calendar readers that silently return the runtime's UTC answer. */
const FORBIDDEN = [/\.getDay\s*\(/, /\.getHours\s*\(/, /\.getDate\s*\(/, /toISOString\(\)\.slice/];

function sourceFilesIn(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFilesIn(full);
    if (!full.endsWith('.ts') || full.endsWith('.test.ts') || full.endsWith('.probe.ts')) return [];
    // businessTime itself is the one module allowed to touch UTC primitives —
    // it is where the conversion lives.
    if (full.endsWith('businessTime.ts')) return [];
    return [full];
  });
}

describe('businessTime - scheduling code does not read the runtime calendar', () => {
  it('should_find_no_forbidden_calendar_call_in_scheduling_modules', () => {
    const offenders: string[] = [];

    for (const root of SCHEDULING_ROOTS) {
      for (const file of sourceFilesIn(root)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN) {
          if (pattern.test(source)) {
            offenders.push(`${file} matches ${pattern}`);
          }
        }
      }
    }

    // Each of these returns the UTC answer, which is wrong for the last three
    // hours of every local day — and returns a plausible number rather than
    // raising, so nothing else would catch it.
    expect(offenders).toEqual([]);
  });
});
