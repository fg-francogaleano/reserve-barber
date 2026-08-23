import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IOwnerReceiptStorage,
  IReceiptStorage,
  ReceiptUpload,
  SignedReceipt,
  StoredReceipt,
} from '@/server/domain/repositories/IReceiptStorage';

/**
 * The bucket transfer receipts live in.
 *
 * **Private by configuration**, unlike `public-profile`. Those images are
 * rendered to unauthenticated clients on every page view, where signing a URL
 * per render would be the wrong mechanism; a document carrying somebody's bank
 * details is the opposite case.
 */
export const TRANSFER_RECEIPT_BUCKET = 'transfer-receipts';

/**
 * How long a review link stays usable.
 *
 * Short because it is generated on the render that shows it and used
 * immediately. A signed URL is a bearer credential for one client's bank
 * document, and it will end up in the owner's browser history either way — a
 * long lifetime turns that entry into a lasting one.
 */
export const RECEIPT_SIGNED_URL_SECONDS = 300;

/**
 * The guest's upload path.
 *
 * **Constructed with a sessionless client**, which is the whole of design D1
 * and the one place in this project where that is correct. The caller has no
 * session to borrow, so the confinement that `auth.uid()` gives the profile
 * bucket is re-derived inside the database by
 * `public.storage_can_accept_receipt()`: an insert is admitted only at a key
 * naming a real booking, in a live hold, under its real owner.
 *
 * The consequence worth knowing is the same shape as P1's: a write at a key the
 * predicate rejects is refused by the **database**, not by this class. The key
 * composition in `TransferReceipt.ts` and the policy in this change's
 * `storage-policy.sql` are two halves of one rule, and the database half is the
 * one that holds.
 */
export class SupabaseReceiptStorage implements IReceiptStorage {
  constructor(private readonly client: SupabaseClient) {}

  async upload(receipt: ReceiptUpload): Promise<StoredReceipt> {
    const { data, error } = await this.client.storage
      .from(TRANSFER_RECEIPT_BUCKET)
      .upload(receipt.key, receipt.bytes, {
        contentType: receipt.contentType,
        // Keys carry an instant, so a collision means a defect rather than a
        // replacement — including the replacement path, which writes a new key
        // rather than overwriting. Failing loudly beats replacing an object a
        // row may still point at.
        upsert: false,
      });

    // Supabase reports failures in the payload rather than by rejecting.
    // Without this check a refused upload — a policy violation, most likely —
    // would look like success, and a `filePath` to a non-existent object would
    // be persisted and only discovered when the owner tried to open it.
    if (error) {
      throw new Error(`Supabase Storage receipt upload failed: ${error.message}`);
    }
    if (!data) {
      throw new Error('Supabase Storage receipt upload returned neither data nor error');
    }

    return { key: receipt.key };
  }
}

/**
 * The owner's read path.
 *
 * **Constructed with the owner's own session client**, so the bucket's
 * `select` policy confines it to their own prefix — the guarantee this project
 * has relied on since P1, available again here because this caller does have a
 * session.
 *
 * A separate class from the uploader rather than a second method on it, so
 * neither credential is ever in reach of the other's caller.
 */
export class SupabaseOwnerReceiptStorage implements IOwnerReceiptStorage {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * A short-lived signed URL that **downloads** rather than renders.
   *
   * The download disposition is not cosmetic. A PDF can carry active content,
   * and an inline render would execute it against the storage origin in the
   * owner's own browser — the most privileged browser in this product, opening
   * a file supplied by a stranger.
   */
  async signForOwner(key: string): Promise<SignedReceipt> {
    const { data, error } = await this.client.storage
      .from(TRANSFER_RECEIPT_BUCKET)
      .createSignedUrl(key, RECEIPT_SIGNED_URL_SECONDS, { download: true });

    if (error) {
      throw new Error(`Supabase Storage receipt signing failed: ${error.message}`);
    }
    if (!data?.signedUrl) {
      throw new Error('Supabase Storage receipt signing returned no URL');
    }

    return { url: data.signedUrl, expiresInSeconds: RECEIPT_SIGNED_URL_SECONDS };
  }
}
