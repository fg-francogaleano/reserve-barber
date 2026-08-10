export class ServiceNotFoundError extends Error {
  constructor() {
    super('Service not found');
    this.name = 'ServiceNotFoundError';
  }
}

export class DuplicateServiceNameError extends Error {
  constructor() {
    super('Duplicate service name for this owner');
    this.name = 'DuplicateServiceNameError';
  }
}

export class ServiceLimitReachedError extends Error {
  constructor() {
    super('Active service limit reached for this owner');
    this.name = 'ServiceLimitReachedError';
  }
}
