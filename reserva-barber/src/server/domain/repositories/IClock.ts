/**
 * Outbound port for wall-clock time and delays. Injected so timing-sensitive
 * logic (e.g. constant-time padding) stays testable without real waiting.
 */
export interface IClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: IClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
