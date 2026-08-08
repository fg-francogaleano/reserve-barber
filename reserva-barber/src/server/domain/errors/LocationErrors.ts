/**
 * Domain errors for the Location aggregate. These exist so that infrastructure
 * failures never travel to the presentation layer wearing their original
 * clothes: a Prisma `P2002` names the constraint and its columns, and the specs
 * forbid that reaching a response body. Translation happens at the application
 * boundary — see `LocationService`.
 */

/**
 * The requested location does not exist **or** belongs to another owner. The
 * two cases are deliberately indistinguishable: answering "forbidden" for the
 * second would confirm the row exists.
 */
export class LocationNotFoundError extends Error {
  constructor(message = 'Location not found') {
    super(message);
    this.name = 'LocationNotFoundError';
  }
}

/** The owner already has a location with this normalized name. */
export class DuplicateLocationNameError extends Error {
  constructor(message = 'A location with this name already exists for this owner') {
    super(message);
    this.name = 'DuplicateLocationNameError';
  }
}

/** The owner has reached the maximum number of locations (design D6). */
export class LocationLimitReachedError extends Error {
  constructor(message = 'The maximum number of locations for this owner has been reached') {
    super(message);
    this.name = 'LocationLimitReachedError';
  }
}
