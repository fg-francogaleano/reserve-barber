/**
 * The recognized receipt types. SVG is excluded — see `detectReceiptType`.
 *
 * A separate union from `ImageContentType`, not a widened one (design D6).
 * WEBP is accepted by the public profile bucket and refused here; PDF is the
 * reverse. One union covering both would let each type reach the wrong bucket
 * with nothing in the type system to notice.
 */
export type ReceiptContentType = 'image/jpeg' | 'image/png' | 'application/pdf';

export interface ReceiptUpload {
  /**
   * The full object key. Composed entirely of server-held values by the caller;
   * no part of it derives from the uploaded file's name.
   *
   * Its leading segment is the booking owner's **Supabase auth user id**, which
   * is what the bucket's owner-scoped read and delete policies compare against
   * the session, and what the anonymous insert predicate re-derives from the
   * booking itself.
   */
  key: string;
  bytes: Uint8Array;
  /**
   * Determined by inspecting the file's leading bytes, never by the
   * client-declared type or the extension — both are client-controlled and
   * prove nothing.
   */
  contentType: ReceiptContentType;
}

export interface StoredReceipt {
  /**
   * The key, which is what gets persisted.
   *
   * **Deliberately not a URL**, and this is the difference from `StoredImage`
   * that justifies a separate contract. The bucket is private: no URL resolves
   * without credentials, and a signed one expires — persisting a signature
   * would store a value that is wrong within the hour.
   */
  key: string;
}

/**
 * A short-lived, credential-bearing address for one stored object.
 *
 * Produced at render time for the owner's review surface and never persisted.
 */
export interface SignedReceipt {
  url: string;
  expiresInSeconds: number;
}

/**
 * Storing a receipt, for the anonymous booking guest.
 *
 * **Two callers with opposite authority, which is why this is two interfaces
 * and not one.** The upload runs for a guest with no session and is admitted by
 * a database predicate; the signed read runs as the owner's own session and is
 * confined to their prefix by policy. A single interface would force one class
 * to hold both credentials, and the more powerful of the two would then be
 * present on the path reached by a stranger.
 */
export interface IReceiptStorage {
  /**
   * Stores a receipt for an anonymous uploader.
   *
   * The implementation MUST NOT overwrite: keys carry an instant, so a
   * collision is a defect rather than a replacement, and failing loudly beats
   * replacing an object a row may still point at.
   */
  upload(receipt: ReceiptUpload): Promise<StoredReceipt>;
}

/**
 * Reading a receipt, for the owner reviewing it.
 *
 * **There is deliberately no `remove` here, and its absence is a decision.** A
 * replacement supersedes an object at the moment an anonymous guest uploads,
 * and that guest holds no delete grant — granting the anonymous role one would
 * let anybody delete anybody's receipt, which is a strictly worse bargain than
 * leaving an object behind. The superseded object is therefore a **bounded
 * orphan**: at most two per booking, since submissions are capped at three.
 * Recorded as debt rather than papered over, and it is what a retention rule
 * would sweep once one exists.
 */
export interface IOwnerReceiptStorage {
  /**
   * A signed address for the owner to open one stored object.
   *
   * The implementation MUST force a download rather than an inline render: a
   * PDF can carry active content, and the alternative is executing it against
   * the storage origin in the owner's own browser.
   */
  signForOwner(key: string): Promise<SignedReceipt>;
}
