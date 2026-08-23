import { describe, it, expect } from 'vitest';
import {
  MAX_RECEIPT_UPLOADS_PER_BOOKING,
  RECEIPT_STATUSES,
  isPendingReview,
  receiptObjectKey,
} from './TransferReceipt';

const OWNER_AUTH_ID = '3f1c9a2e-7b4d-4e11-9a55-0c2d8e6f1a30';
const BOOKING_ID = 'ckv8x2p9q0001abcd1234efgh';

describe('receiptObjectKey', () => {
  it('composes owner, booking, instant and the detected extension', () => {
    const uploadedAt = new Date('2026-08-22T15:04:05.000Z');

    const key = receiptObjectKey({
      ownerAuthUserId: OWNER_AUTH_ID,
      bookingId: BOOKING_ID,
      uploadedAt,
      contentType: 'application/pdf',
    });

    expect(key).toBe(`${OWNER_AUTH_ID}/${BOOKING_ID}/${uploadedAt.getTime()}.pdf`);
  });

  // The leading segment is what the bucket's owner-scoped policies compare
  // against `auth.uid()`, and what the anonymous insert predicate re-derives.
  it('puts the auth user id first, because that is what a policy can compare', () => {
    const key = receiptObjectKey({
      ownerAuthUserId: OWNER_AUTH_ID,
      bookingId: BOOKING_ID,
      uploadedAt: new Date(0),
      contentType: 'image/png',
    });

    expect(key.split('/')[0]).toBe(OWNER_AUTH_ID);
    expect(key.split('/')[1]).toBe(BOOKING_ID);
  });

  it('derives the extension from the detected type, not from any declaration', () => {
    const jpeg = receiptObjectKey({
      ownerAuthUserId: OWNER_AUTH_ID,
      bookingId: BOOKING_ID,
      uploadedAt: new Date(0),
      contentType: 'image/jpeg',
    });

    expect(jpeg.endsWith('.jpg')).toBe(true);
  });

  // Storage keys accept path separators, so anything reaching a key that a
  // client controls is a traversal primitive. Nothing here comes from one.
  it('produces exactly three segments and no traversal', () => {
    const key = receiptObjectKey({
      ownerAuthUserId: OWNER_AUTH_ID,
      bookingId: BOOKING_ID,
      uploadedAt: new Date('2026-08-22T15:04:05.000Z'),
      contentType: 'image/png',
    });

    expect(key.split('/')).toHaveLength(3);
    expect(key).not.toContain('..');
  });

  it('refuses to build a key from an owner with no auth user id', () => {
    expect(() =>
      receiptObjectKey({
        ownerAuthUserId: '',
        bookingId: BOOKING_ID,
        uploadedAt: new Date(0),
        contentType: 'image/png',
      })
    ).toThrow();
  });

  // A value carrying a separator would silently change the key's shape and
  // land the object under a different prefix.
  it('refuses identifiers that carry a path separator', () => {
    expect(() =>
      receiptObjectKey({
        ownerAuthUserId: OWNER_AUTH_ID,
        bookingId: `../${BOOKING_ID}`,
        uploadedAt: new Date(0),
        contentType: 'image/png',
      })
    ).toThrow();
  });
});

describe('isPendingReview', () => {
  it('is true only while a human still owes an answer', () => {
    expect(isPendingReview('PENDING')).toBe(true);
    expect(isPendingReview('APPROVED')).toBe(false);
    expect(isPendingReview('REJECTED')).toBe(false);
  });
});

describe('the review states', () => {
  it('are the three the schema declares', () => {
    expect(RECEIPT_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
  });
});

describe('MAX_RECEIPT_UPLOADS_PER_BOOKING', () => {
  // The bound that actually holds: the per-origin throttle is per-isolate, and
  // the token's holder is a legitimate client rather than an attacker.
  it('leaves room to correct a wrong photo without being unbounded', () => {
    expect(MAX_RECEIPT_UPLOADS_PER_BOOKING).toBe(3);
  });
});
