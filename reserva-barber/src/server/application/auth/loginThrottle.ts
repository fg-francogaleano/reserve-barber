export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const COOLDOWN_MS = 60 * 1000;

/**
 * Hard cap on tracked email+IP pairs. Without it, an attacker rotating emails
 * grows the map until the isolate runs out of memory — a DoS inside the very
 * code meant to blunt one.
 */
export const MAX_TRACKED_KEYS = 1000;

interface AttemptRecord {
  count: number;
  windowStart: number;
  cooldownUntil: number | null;
}

/**
 * Best-effort, per-isolate login throttling (design D7): defense-in-depth over
 * the auth provider's own rate limits. 5 failed attempts per email+IP within
 * a 15-minute window trigger a 60-second cooldown; a success resets the counter.
 */
export class LoginThrottle {
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(email: string, ip: string): string {
    return `${email}:${ip}`;
  }

  /** Number of tracked pairs — exposed so tests can assert the memory bound. */
  get size(): number {
    return this.attempts.size;
  }

  /**
   * Drops records whose window has elapsed and whose cooldown has ended.
   * Records still in cooldown are kept even past their window, so an attacker
   * cannot flush their own lockout by spraying keys.
   */
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
   * Makes room for a new key, returning false when none can be freed.
   * Expired records go first; then the oldest records *not currently in
   * cooldown* (Map preserves insertion order). Active cooldowns are never
   * evicted — otherwise an attacker could flush their own lockout by spraying
   * keys. If every slot is locked out, the new key simply goes untracked:
   * memory stays bounded and existing lockouts hold.
   */
  private makeRoom(t: number): boolean {
    if (this.attempts.size < MAX_TRACKED_KEYS) {
      return true;
    }
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
      if (!evicted) {
        return false;
      }
    }
    return true;
  }

  isThrottled(email: string, ip: string): boolean {
    const record = this.attempts.get(this.key(email, ip));
    if (!record || record.cooldownUntil === null) {
      return false;
    }
    return this.now() < record.cooldownUntil;
  }

  recordFailure(email: string, ip: string): void {
    const key = this.key(email, ip);
    const t = this.now();
    const record = this.attempts.get(key);

    if (!record || t - record.windowStart > WINDOW_MS) {
      if (!record && !this.makeRoom(t)) {
        return;
      }
      this.attempts.set(key, { count: 1, windowStart: t, cooldownUntil: null });
      return;
    }

    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      record.cooldownUntil = t + COOLDOWN_MS;
    }
  }

  recordSuccess(email: string, ip: string): void {
    this.attempts.delete(this.key(email, ip));
  }
}
