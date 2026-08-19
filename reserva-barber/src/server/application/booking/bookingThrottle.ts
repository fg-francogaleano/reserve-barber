/**
 * Per-origin rate limiting for the public booking write (B4 design D9).
 *
 * **This is the weaker of the two bounds, and saying so is the point.** It is
 * per-isolate: `workerd` gives no counter shared across isolates, so a
 * distributed attempt simply lands on different instances and each sees a
 * fresh map. What it does defeat is the naive case — one script, one address,
 * a tight loop — which is the shape of nearly every real abuse of an
 * unauthenticated endpoint.
 *
 * The bound that actually holds is `MAX_LIVE_HOLDS_PER_CLIENT`, checked
 * against the database in `BookingCreationService`, which cannot be spread
 * across isolates because the rows are shared.
 *
 * An accepted debt with a false justification is worse than one with none
 * (B1 design D12), so the limitation is recorded here and in `tech-debt.md`
 * rather than implied by the module's existence.
 *
 * The shape follows `loginThrottle.ts` deliberately: a hard key cap so an
 * attacker rotating origins cannot grow the map until the isolate runs out of
 * memory — a denial of service inside the code meant to blunt one.
 */

/** Attempts allowed per origin within the window. */
export const MAX_ATTEMPTS = 10;
export const WINDOW_MS = 60 * 1000;
export const COOLDOWN_MS = 60 * 1000;

/** Hard cap on tracked origins, for the reason `loginThrottle` caps its own. */
export const MAX_TRACKED_KEYS = 1000;

interface AttemptRecord {
  count: number;
  windowStart: number;
  cooldownUntil: number | null;
}

export class BookingThrottle {
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Number of tracked origins — exposed so tests can assert the memory bound. */
  get size(): number {
    return this.attempts.size;
  }

  private prune(t: number): void {
    for (const [key, record] of this.attempts) {
      const windowExpired = t - record.windowStart > WINDOW_MS;
      const cooldownOver = record.cooldownUntil === null || t >= record.cooldownUntil;
      if (windowExpired && cooldownOver) {
        this.attempts.delete(key);
      }
    }
  }

  /**
   * Makes room for a new key. Expired records go first, then the oldest not
   * currently in cooldown. **An active cooldown is never evicted** — otherwise
   * an attacker flushes their own lockout by spraying origins, which is the
   * one move this module exists to stop.
   */
  private makeRoom(t: number): boolean {
    if (this.attempts.size < MAX_TRACKED_KEYS) return true;
    this.prune(t);

    while (this.attempts.size >= MAX_TRACKED_KEYS) {
      let evicted = false;
      for (const [key, record] of this.attempts) {
        const inCooldown = record.cooldownUntil !== null && t < record.cooldownUntil;
        if (!inCooldown) {
          this.attempts.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) return false;
    }
    return true;
  }

  isThrottled(origin: string): boolean {
    const record = this.attempts.get(origin);
    if (!record || record.cooldownUntil === null) return false;
    return this.now() < record.cooldownUntil;
  }

  /**
   * Counts an attempt, whatever its outcome.
   *
   * Unlike the login throttle, which counts only failures, this one counts
   * **every** submission. A booking flood is made of requests that each
   * succeed — that is precisely what makes it a calendar lock — so counting
   * only failures would leave the abuse case untouched.
   */
  record(origin: string): void {
    const t = this.now();
    const record = this.attempts.get(origin);

    if (!record || t - record.windowStart > WINDOW_MS) {
      if (!record && !this.makeRoom(t)) return;
      this.attempts.set(origin, { count: 1, windowStart: t, cooldownUntil: null });
      return;
    }

    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      record.cooldownUntil = t + COOLDOWN_MS;
    }
  }
}
