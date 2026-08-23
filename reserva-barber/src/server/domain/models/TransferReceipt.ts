/**
 * The receipt's review states, the bound on how many times a client may try,
 * and the one place a storage key for a receipt is built.
 *
 * Deliberately free of Prisma, storage clients and `fetch`. What a bucket looks
 * like is an infrastructure concern; what a key is *allowed to contain* is a
 * domain rule, and it is the only thing standing between a client-supplied file
 * and an object written under somebody else's prefix.
 */

import { receiptExtensionFor } from './receiptFileType';
import type { ReceiptContentType } from '@/server/domain/repositories/IReceiptStorage';

export const RECEIPT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * Whether a human still owes this receipt an answer.
 *
 * The predicate that decides whether a further submission replaces the existing
 * receipt or is refused. Kept here so the route, the repository and the review
 * surface cannot drift into three definitions of "still open".
 */
export function isPendingReview(status: ReceiptStatus): boolean {
  return status === 'PENDING';
}

/**
 * How many receipt submissions one booking may make.
 *
 * **This is the bound that actually holds.** The per-origin throttle is
 * per-isolate and does not survive a caller moving between them
 * (`tech-debt.md` T55), and the caller here is not an anonymous stranger but
 * the holder of a valid cancellation token — a legitimate client, whose
 * ordinary mistake is uploading the wrong photo.
 *
 * Three leaves room for that mistake twice without leaving an unbounded write
 * path into object storage.
 */
export const MAX_RECEIPT_UPLOADS_PER_BOOKING = 3;

export interface ReceiptKeyInput {
  /**
   * The **Supabase auth user id** of the booking's owner, not `Owner.id`.
   *
   * They are distinct values, and only this one is what a bucket policy can
   * compare against `auth.uid()` — the same distinction P1's storage policy
   * calls out. Getting it wrong yields objects the owner cannot read back.
   */
  readonly ownerAuthUserId: string;
  readonly bookingId: string;
  readonly uploadedAt: Date;
  /** The **detected** type. Never the declared one. */
  readonly contentType: ReceiptContentType;
}

/**
 * A segment is rejected rather than escaped.
 *
 * Escaping would still produce a key, and a key that is merely *different* from
 * the intended one is worse than no key at all: the object lands somewhere the
 * owner's policy does not reach and the row points at it anyway. Both values
 * here are server-held identifiers, so a separator in one is a defect upstream,
 * and the right response is to stop.
 */
function requireSafeSegment(value: string, field: string): string {
  if (value.length === 0) {
    throw new Error(`Cannot compose a receipt key: ${field} is empty`);
  }
  if (/[/\\]/.test(value) || value.includes('..')) {
    throw new Error(`Cannot compose a receipt key: ${field} contains a path separator`);
  }
  return value;
}

/**
 * The only place a receipt's storage key is built.
 *
 * `{ownerAuthUserId}/{bookingId}/{uploadedAtEpochMs}.{ext}` — every part from a
 * server-held value, and **no part from the uploaded file's name**. Storage
 * keys accept path separators, so a filename reaching a key is a traversal
 * primitive, and this private bucket holding other people's bank documents is
 * precisely what such a traversal would aim at.
 *
 * The instant makes a replacement a new object rather than an overwrite, which
 * is what lets the adapter refuse to upsert: a collision then means a defect
 * instead of a legitimate replacement.
 */
export function receiptObjectKey(input: ReceiptKeyInput): string {
  const owner = requireSafeSegment(input.ownerAuthUserId, 'ownerAuthUserId');
  const booking = requireSafeSegment(input.bookingId, 'bookingId');
  const extension = receiptExtensionFor(input.contentType);

  return `${owner}/${booking}/${input.uploadedAt.getTime()}.${extension}`;
}
