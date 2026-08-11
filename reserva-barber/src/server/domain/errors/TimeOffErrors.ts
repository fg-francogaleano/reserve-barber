export class TimeOffNotFoundError extends Error {
  constructor() {
    super('Time off not found');
    this.name = 'TimeOffNotFoundError';
  }
}

export class TimeOffLimitReachedError extends Error {
  constructor() {
    super('Time off limit reached for this barber');
    this.name = 'TimeOffLimitReachedError';
  }
}
