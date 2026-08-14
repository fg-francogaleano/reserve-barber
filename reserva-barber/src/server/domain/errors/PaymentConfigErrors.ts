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

/**
 * A stored credential could not be authenticated — a corrupted envelope, a
 * value encrypted under a different key, or one lifted from another owner or
 * purpose.
 *
 * Deliberately distinct from "no credential stored". A caller that cannot tell
 * the two apart reports an owner's configured credentials as missing, or as
 * usable when they cannot be used. Both are wrong far from their cause, which
 * is why the dashboard renders this as a state of its own (design D12).
 *
 * Carries no ciphertext, no recovered bytes and no key. There is nothing
 * diagnostic in the material itself, and everything dangerous.
 */
export class CredentialDecryptionError extends Error {
  constructor() {
    super('Stored credential could not be decrypted');
    this.name = 'CredentialDecryptionError';
  }
}

/**
 * The encryption key is absent, or present but unusable. A configuration fault,
 * not a data fault — the stored credentials are probably fine, and telling the
 * owner to re-enter them would be wrong advice.
 *
 * Names the variable so a deploy that forgot it is diagnosable from one line
 * (design D11). Never carries the value.
 */
export class CredentialKeyMissingError extends Error {
  constructor(reason: string) {
    super(`PAYMENT_CREDENTIALS_KEY is unusable: ${reason}`);
    this.name = 'CredentialKeyMissingError';
  }
}

/**
 * Mercado Pago answered, and the answer is that these credentials are not
 * valid. Blocks the write (design D5): the owner's input is wrong and storing
 * it would leave a payment method that fails when a client tries to pay.
 */
export class MercadoPagoRejectedError extends Error {
  constructor() {
    super('Mercado Pago rejected the submitted credentials');
    this.name = 'MercadoPagoRejectedError';
  }
}

/**
 * Mercado Pago could not be reached, failed, or did not answer in time. Does
 * NOT block the write (design D5) — refusing to save because a third party is
 * down would be this feature failing for a reason unrelated to the owner's
 * input. The save proceeds and is reported as unverified.
 */
export class MercadoPagoUnavailableError extends Error {
  constructor() {
    super('Mercado Pago could not be reached to verify the credentials');
    this.name = 'MercadoPagoUnavailableError';
  }
}
