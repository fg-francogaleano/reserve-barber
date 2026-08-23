import { describe, it, expect } from 'vitest';
import {
  hasTransferConfigured,
  isTransferOfferableToClient,
  isBookable,
  type TransferDetails,
} from './PaymentConfig';

function transfer(overrides: Partial<TransferDetails> = {}): TransferDetails {
  return {
    cbuCvu: null,
    alias: null,
    holderName: null,
    ...overrides,
  };
}

describe('isTransferOfferableToClient', () => {
  it('accepts a CBU with a holder name', () => {
    expect(
      isTransferOfferableToClient(transfer({ cbuCvu: '0000003100010000000001', holderName: 'Ana' }))
    ).toBe(true);
  });

  it('accepts an alias with a holder name', () => {
    expect(isTransferOfferableToClient(transfer({ alias: 'mi.barberia', holderName: 'Ana' }))).toBe(
      true
    );
  });

  /**
   * The rule this predicate exists for. Without the holder name a client cannot
   * confirm from their own bank's screen that they are paying the right
   * business, and the column is nullable only because the whole destination is
   * optional — so a half-filled row can reach the public flow.
   */
  it('refuses a destination with no holder name', () => {
    expect(isTransferOfferableToClient(transfer({ cbuCvu: '0000003100010000000001' }))).toBe(false);
    expect(isTransferOfferableToClient(transfer({ alias: 'mi.barberia' }))).toBe(false);
  });

  it('refuses a holder name with nowhere to send the money', () => {
    expect(isTransferOfferableToClient(transfer({ holderName: 'Ana' }))).toBe(false);
  });

  it('refuses an empty destination', () => {
    expect(isTransferOfferableToClient(transfer())).toBe(false);
  });
});

describe('isTransferOfferableToClient is stricter than the bookability gate', () => {
  /**
   * The two predicates deliberately disagree on this row, and the disagreement
   * is the accepted consequence: B4 lets such a shop take a booking, and B6
   * declines to show the client an unusable destination. Tightening
   * `hasTransferConfigured` instead would retroactively close the booking flow
   * for a shop the write already admits, which is not this rule's business.
   */
  it('leaves the booking gate open for a destination it will not show', () => {
    const half = transfer({ cbuCvu: '0000003100010000000001' });

    expect(hasTransferConfigured(half)).toBe(true);
    expect(
      isBookable({ hasMercadoPagoCredentials: false, transfer: half, depositValue: '500.00' }).ready
    ).toBe(true);
    expect(isTransferOfferableToClient(half)).toBe(false);
  });
});
