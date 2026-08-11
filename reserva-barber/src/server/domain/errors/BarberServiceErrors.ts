/**
 * Carries the offending service name so the editor can identify *which*
 * selection failed. With up to 50 checkboxes, a form-level "something is
 * unavailable" tells the owner nothing they can act on.
 *
 * `serviceName` is empty when the id matched no row the owner can see — an
 * unknown or foreign id has no name to report, and inventing one would leak
 * whether the id exists.
 */
export class ServiceNotAssignableError extends Error {
  constructor(
    public readonly serviceName: string,
    /** Lets the editor mark the offending checkbox rather than only the form. */
    public readonly serviceId: string | null = null
  ) {
    super(
      serviceName
        ? `Service is not assignable: ${serviceName}`
        : 'Service is not assignable: unknown or not owned'
    );
    this.name = 'ServiceNotAssignableError';
  }
}

// A `TooManyAssignmentsError` was specified alongside this one and deliberately
// not created. The cap is enforced by `barberServicesSchema` before any read,
// and the application service accepts only that schema's output type — so the
// over-cap state is unreachable rather than merely handled. A domain error no
// code path can throw is dead weight that reads as a live guarantee.
