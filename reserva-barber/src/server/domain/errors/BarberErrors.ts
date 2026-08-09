export class BarberNotFoundError extends Error {
  constructor() {
    super('Barber not found');
    this.name = 'BarberNotFoundError';
  }
}

export class DuplicateBarberNameError extends Error {
  constructor(public readonly locationName: string) {
    super(`Duplicate barber name at location: ${locationName}`);
    this.name = 'DuplicateBarberNameError';
  }
}

export class LocationNotAvailableError extends Error {
  constructor() {
    super('Location is not available');
    this.name = 'LocationNotAvailableError';
  }
}

export class BarberLimitReachedError extends Error {
  constructor() {
    super('Barber limit reached for this location');
    this.name = 'BarberLimitReachedError';
  }
}
