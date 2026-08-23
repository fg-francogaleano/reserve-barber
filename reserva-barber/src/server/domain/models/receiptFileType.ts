import type { ReceiptContentType } from '@/server/domain/repositories/IReceiptStorage';

/**
 * What a transfer receipt may be, decided by its bytes.
 *
 * A deliberate sibling of `imageType.ts` rather than an extension of it. The
 * two lists must not drift into each other: WEBP belongs to the public profile
 * bucket and not here, PDF belongs here and not there, and a single widened
 * union would let each type reach the wrong bucket silently (design D6).
 */

/**
 * The server-side ceiling, matching `file_size_limit` on the bucket
 * (`openspec/changes/b6-transfer-deposit-and-review/storage-policy.sql`).
 *
 * Three layers guard it, each for a different reason: the route refuses on
 * `Content-Length` before reading the body, which is a memory guard in an
 * isolate with a hard bound; the byte length is re-checked afterwards, because
 * that header is client-controlled; and the bucket refuses it a third time,
 * because a policy in the database outranks a check in the application.
 *
 * There is no browser-side downscale here, unlike P1. An image could be
 * reduced, but a PDF from a bank cannot, and a rule that applied to only half
 * the accepted types would be a rule nobody could rely on.
 */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** The accepted types, in one place so the bucket's list can be checked against it. */
export const RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const satisfies readonly ReceiptContentType[];

/**
 * Leading-byte signatures. Deliberately not a lookup on the declared MIME type
 * or the file extension: both are client-controlled and prove nothing about
 * what the bytes are.
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "%PDF-" — the header every conforming PDF opens with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Identifies a receipt by its content, or returns `null` when it is not one of
 * the accepted types.
 *
 * SVG is absent on purpose. It is an image, a client will occasionally send
 * one, and it is a script-execution surface — and although this bucket is
 * private, the file is later opened in the **owner's** own browser, which is a
 * worse place for script to run than a stranger's.
 */
export function detectReceiptType(bytes: Uint8Array): ReceiptContentType | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  return null;
}

const EXTENSIONS: Record<ReceiptContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * The extension for a storage key, derived from the **detected** type.
 *
 * Never taken from the uploaded file's name. Storage keys accept path
 * separators, so a filename reaching the key is a traversal primitive — and
 * this private bucket is exactly what such a traversal would aim at.
 */
export function receiptExtensionFor(contentType: ReceiptContentType): string {
  return EXTENSIONS[contentType];
}
