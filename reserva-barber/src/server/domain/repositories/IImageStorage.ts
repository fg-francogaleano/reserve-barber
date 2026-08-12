/** The recognized image types. SVG is excluded — see `ImageUpload.contentType`. */
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageUpload {
  /**
   * The full object key. Composed entirely of server-held values by the caller;
   * no part of it derives from the uploaded file's name.
   *
   * Its leading segment is the authenticated user's id, which is what the
   * bucket policy compares against the session. That makes the confinement a
   * database guarantee rather than an application promise (design D5/D13).
   */
  key: string;
  bytes: Uint8Array;
  /**
   * Determined by inspecting the file's leading bytes, never by the
   * client-declared type or the extension — both are client-controlled and
   * prove nothing.
   */
  contentType: ImageContentType;
}

export interface StoredImage {
  key: string;
  /**
   * The URL to persist and render.
   *
   * Whether this resolves without credentials is a property of the configured
   * bucket, not of this contract. That is deliberate: B6 stores transfer
   * receipts in a private bucket and must be able to implement this interface
   * without the contract having promised public readability (design D12).
   */
  url: string;
}

/**
 * Object storage for images the application serves.
 *
 * An interface in the domain layer so `BusinessProfileService` can be unit
 * tested with no network, and so the private-bucket implementation B6 needs is
 * an addition rather than a rewrite.
 */
export interface IImageStorage {
  upload(image: ImageUpload): Promise<StoredImage>;

  /**
   * Best-effort removal of a previously stored object, identified by the URL
   * that was persisted for it.
   *
   * A URL rather than a key because a URL is what the profile holds: the domain
   * never stores keys, and reversing the URL is something the adapter that
   * produced it can do without the caller learning how keys are shaped.
   *
   * Callers treat a failure here as non-fatal and log it. Reclaiming a few
   * hundred kilobytes must never be the reason an owner's save fails
   * (design D6).
   */
  remove(storedUrl: string): Promise<void>;
}
