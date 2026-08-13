import type { ImageContentType } from '@/server/domain/repositories/IImageStorage';

/**
 * The server-side ceiling, matching `file_size_limit` on the bucket
 * (`openspec/changes/p1-owner-public-profile/storage-policy.sql`).
 *
 * Three layers guard this, and each is there for a different reason: the browser
 * downscales to a few hundred kilobytes so the payload fits the unchanged Server
 * Action body limit; this check refuses anything that arrives larger anyway,
 * because the client is an environment we do not control; and the bucket refuses
 * it a third time, because a policy in the database outranks a check in the
 * application.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Leading-byte signatures. Deliberately not a lookup on the declared MIME type
 * or the file extension: both are client-controlled and prove nothing about what
 * the bytes are.
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "RIFF" at offset 0 and "WEBP" at offset 8 — the first alone also matches WAV. */
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Identifies an image by its content, or returns `null` when it is not one of
 * the accepted types.
 *
 * SVG is absent on purpose rather than by oversight: an SVG served from a public
 * origin can execute script, and these objects are served to anonymous clients.
 * GIF is absent because the bucket does not allow it — the two lists must agree,
 * and this is the one that runs first.
 */
export function detectImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_MARKER, 8)) return 'image/webp';
  return null;
}

const EXTENSIONS: Record<ImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The extension for a storage key, derived from the detected type.
 *
 * Never taken from the uploaded file's name. Storage keys accept path
 * separators, so a filename reaching the key is a traversal primitive — and the
 * private bucket B6 will add for transfer receipts is exactly what such a
 * traversal would aim at (design D5).
 */
export function extensionFor(contentType: ImageContentType): string {
  return EXTENSIONS[contentType];
}
