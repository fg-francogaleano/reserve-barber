/**
 * Minutes from midnight → "HH:mm", the value `<input type="time">` expects.
 *
 * Formatting lives in presentation, never in the domain — the same split M3
 * made for money. The stored value is wall clock, so this applies no offset and
 * must not: converting here would silently reinterpret the owner's schedule.
 */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
