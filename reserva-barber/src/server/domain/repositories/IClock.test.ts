import { describe, it, expect } from 'vitest';
import { systemClock } from './IClock';

describe('systemClock', () => {
  it('should_report_wall_clock_time', () => {
    const before = Date.now();

    const reported = systemClock.now();

    expect(reported).toBeGreaterThanOrEqual(before);
    expect(reported).toBeLessThanOrEqual(Date.now());
  });

  it('should_resolve_after_at_least_the_requested_delay', async () => {
    const startedAt = Date.now();

    await systemClock.sleep(5);

    // Timers may fire a tick early on some platforms — allow 1ms of slack.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4);
  });
});
