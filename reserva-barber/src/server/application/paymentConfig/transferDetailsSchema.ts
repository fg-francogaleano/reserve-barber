import { normalizeCbu, checkCbu, normalizeAlias, checkAlias } from '@/server/domain/models/cbu';
import { normalizeHolderName, checkHolderName } from '@/server/domain/models/holderName';
import type { TransferDetails } from '@/server/domain/models/PaymentConfig';

/**
 * Parses and validates the bank transfer destination.
 *
 * Returns error **codes**, never Spanish strings: mapping a code to a message
 * is the presentation layer's job, and each code names a distinct mistake. A
 * destination rejected for its length and one rejected for its check digits
 * explain different things to the owner, so they never collapse into "invalid".
 */

export type TransferFieldError =
  | 'invalid_chars'
  | 'invalid_length'
  | 'invalid_checksum'
  | 'holder_required';

export type TransferFormError = 'no_destination';

export interface TransferFieldErrors {
  cbuCvu?: TransferFieldError;
  alias?: TransferFieldError;
  holderName?: TransferFieldError;
  /** Not attached to a field: the mistake is the combination, not any one input. */
  form?: TransferFormError;
}

export type TransferParseResult =
  | { ok: true; data: TransferDetails }
  | { ok: false; fieldErrors: TransferFieldErrors };

export interface RawTransferInput {
  cbuCvu: unknown;
  alias: unknown;
  holderName: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function hasErrors(fieldErrors: TransferFieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}

/**
 * The section resolves to one of three states (spec: "three states, and the
 * empty one is valid"):
 *
 * - **Unconfigured** — everything blank. Transfer is not offered, which is a
 *   legitimate choice for an owner using Mercado Pago only.
 * - **Configured** — a holder name plus at least one destination.
 * - **Invalid** — anything else. Rejected in full; nothing is written.
 */
export function parseTransferDetails(raw: RawTransferInput): TransferParseResult {
  const cbuCvu = normalizeCbu(asString(raw.cbuCvu).trim());
  const alias = normalizeAlias(asString(raw.alias));
  const holderName = normalizeHolderName(asString(raw.holderName));

  if (cbuCvu === '' && alias === '' && holderName === '') {
    return { ok: true, data: { cbuCvu: null, alias: null, holderName: null } };
  }

  const fieldErrors: TransferFieldErrors = {};

  if (cbuCvu !== '') {
    const error = checkCbu(cbuCvu);
    if (error) {
      fieldErrors.cbuCvu = error;
    }
  }

  if (alias !== '') {
    const error = checkAlias(alias);
    if (error) {
      fieldErrors.alias = error;
    }
  }

  const hasDestination = cbuCvu !== '' || alias !== '';

  if (!hasDestination) {
    // A holder name with nowhere to send the money. Reported at form level
    // because no single field is wrong — the combination is.
    fieldErrors.form = 'no_destination';
  } else if (holderName === '') {
    // A destination with no holder name is unusable: the client cannot confirm
    // from their bank's screen that they are paying the right business.
    fieldErrors.holderName = 'holder_required';
  }

  if (holderName !== '') {
    const error = checkHolderName(holderName);
    if (error) {
      fieldErrors.holderName = error;
    }
  }

  if (hasErrors(fieldErrors)) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      cbuCvu: cbuCvu === '' ? null : cbuCvu,
      alias: alias === '' ? null : alias,
      holderName: holderName === '' ? null : holderName,
    },
  };
}
