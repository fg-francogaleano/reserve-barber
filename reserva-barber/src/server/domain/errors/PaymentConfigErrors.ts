export class PaymentConfigNotFoundError extends Error {
  constructor() {
    super('Payment config not found');
    this.name = 'PaymentConfigNotFoundError';
  }
}

/**
 * Raised when a write loses the race to create the singleton row and the single
 * bounded retry also fails (design D12). The first violation is absorbed by the
 * retry, which finds the row and takes the update path; a second one is a real
 * failure and must not be retried again.
 */
export class PaymentConfigWriteConflictError extends Error {
  constructor() {
    super('Payment config write conflict persisted after one retry');
    this.name = 'PaymentConfigWriteConflictError';
  }
}
