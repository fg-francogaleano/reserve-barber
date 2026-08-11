/**
 * GATE M5a — timezone support, shared by the Node script and the runtime route.
 *
 * Lives beside the module it exercises so both runtimes run the **same** probe.
 * A copy in each would let them drift, and the whole point is to compare one
 * runtime against another.
 *
 * The failure this guards against is silent: a runtime without timezone data
 * does not raise, it reports UTC. So every probe asserts a **known value**
 * rather than merely that a call returned.
 */
import {
  BUSINESS_TIME_ZONE,
  BUSINESS_UTC_OFFSET_MINUTES,
  hasTimezoneSupport,
  instantToLocal,
  localToInstant,
  minuteOfDayOf,
  offsetMinutesAt,
  weekdayOf,
} from './businessTime';

export interface ProbeResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function runTimezoneProbes(): ProbeResult[] {
  const results: ProbeResult[] = [];
  const add = (name: string, passed: boolean, detail: string) =>
    results.push({ name, passed, detail });

  // A — the runtime carries tzdata at all. Asserting a known offset, because an
  // unsupported zone yields UTC rather than an error.
  const offset = offsetMinutesAt(new Date('2026-01-01T12:00:00.000Z'));
  add(
    'A tzdata present',
    offset === BUSINESS_UTC_OFFSET_MINUTES,
    `offset=${offset} (expected ${BUSINESS_UTC_OFFSET_MINUTES}); 0 means a silent UTC fallback`
  );

  // B — the silent-fallback detector itself works: an unsupported zone must not
  // be mistaken for a supported one. `Etc/UTC` is genuinely 0, so a runtime that
  // reports 0 for Buenos Aires is indistinguishable from one that has no data —
  // which is exactly why probe A asserts −180 and not "did not throw".
  add(
    'B fallback is detectable',
    hasTimezoneSupport() === (offset === BUSINESS_UTC_OFFSET_MINUTES),
    `hasTimezoneSupport()=${hasTimezoneSupport()} agrees with the measured offset`
  );

  // C — wall clock survives a round trip.
  const local = { year: 2026, month: 8, day: 11, minuteOfDay: 9 * 60 };
  const back = instantToLocal(localToInstant(local));
  add(
    'C wall-clock round trip',
    back.year === local.year &&
      back.month === local.month &&
      back.day === local.day &&
      back.minuteOfDay === local.minuteOfDay,
    `09:00 local -> ${localToInstant(local).toISOString()} -> ${String(
      Math.floor(back.minuteOfDay / 60)
    ).padStart(2, '0')}:${String(back.minuteOfDay % 60).padStart(2, '0')} on ${back.day}/${back.month}`
  );

  // D — the weekday is the business's, not the runtime's. 2026-08-10T00:30:00Z
  // is Monday in UTC and Sunday 21:30 in Buenos Aires. This is the three-hour
  // window where `getDay()` is wrong every single day.
  const eveningInstant = new Date('2026-08-10T00:30:00.000Z');
  const businessWeekday = weekdayOf(eveningInstant);
  const runtimeWeekday = eveningInstant.getUTCDay();
  add(
    'D weekday is business-local',
    businessWeekday === 0 && runtimeWeekday === 1,
    `business=${businessWeekday} (Sunday), runtime=${runtimeWeekday} (Monday) — they must differ here`
  );

  // E — minute of day likewise.
  const minute = minuteOfDayOf(eveningInstant);
  add(
    'E minute of day is business-local',
    minute === 21 * 60 + 30,
    `minuteOfDay=${minute} (expected ${21 * 60 + 30} = 21:30)`
  );

  // F — a local midnight maps to 03:00Z, the boundary an all-day range depends on.
  const midnight = localToInstant({ year: 2026, month: 8, day: 11, minuteOfDay: 0 });
  add(
    'F local midnight maps to 03:00Z',
    midnight.toISOString() === '2026-08-11T03:00:00.000Z',
    `got ${midnight.toISOString()}`
  );

  return results;
}

export const PROBE_ZONE = BUSINESS_TIME_ZONE;
