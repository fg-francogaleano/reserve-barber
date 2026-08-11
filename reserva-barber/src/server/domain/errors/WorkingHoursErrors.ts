/**
 * Carries the offending weekday so the editor can point at a specific row.
 *
 * A form-level "invalid schedule" over a seven-day grid tells the owner nothing
 * they can act on — the same reasoning that gave `ServiceNotAssignableError` its
 * service name in M4.
 */
export class InvalidWorkingWindowError extends Error {
  constructor(
    public readonly dayOfWeek: number,
    public readonly code: WorkingWindowErrorCode
  ) {
    super(`Invalid working window on day ${dayOfWeek}: ${code}`);
    this.name = 'InvalidWorkingWindowError';
  }
}

export type WorkingWindowErrorCode =
  | 'incomplete'
  | 'end_not_after_start'
  | 'not_on_grid'
  | 'out_of_day';
