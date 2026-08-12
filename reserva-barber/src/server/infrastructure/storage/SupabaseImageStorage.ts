import type { SupabaseClient } from '@supabase/supabase-js';
import type { IImageStorage, ImageUpload, StoredImage } from '@/server/domain/repositories/IImageStorage';

/**
 * The bucket profile and cover images live in.
 *
 * Public by configuration, because these images are rendered to unauthenticated
 * clients in the booking flow. That reasoning does not transfer: transfer
 * receipts (B6) get their own private bucket, with the same policy shape and no
 * public read.
 */
export const PUBLIC_PROFILE_BUCKET = 'public-profile';

/** Where a Supabase public object URL keeps the bucket and the key. */
const PUBLIC_OBJECT_PATH = '/storage/v1/object/public/';

/**
 * Supabase Storage adapter for the public profile bucket.
 *
 * **Constructed with the caller's session-bound client**, never with one of its
 * own. That is the whole of design D13: uploads run with the owner's session and
 * are authorized by the bucket policy, so no service-role credential exists in
 * the application's runtime at all. `scripts/provision-owner.ts:7` and
 * `.env.example` both forbid that key here, because it bypasses row-level
 * security across the entire database.
 *
 * The consequence worth knowing: a write outside the owner's own prefix is
 * refused by the database, not by this class. The key composition in
 * `BusinessProfileService` and the policy in
 * `openspec/changes/p1-owner-public-profile/storage-policy.sql` are two halves of
 * one rule, and the database half is the one that holds.
 */
export class SupabaseImageStorage implements IImageStorage {
  constructor(private readonly client: SupabaseClient) {}

  async upload(image: ImageUpload): Promise<StoredImage> {
    const bucket = this.client.storage.from(PUBLIC_PROFILE_BUCKET);

    const { data, error } = await bucket.upload(image.key, image.bytes, {
      contentType: image.contentType,
      // Keys carry a timestamp, so a collision means a defect rather than a
      // replacement. Failing loudly beats overwriting an object the profile may
      // still point at.
      upsert: false,
    });

    // Supabase reports failures in the payload rather than by rejecting. Without
    // this check a refused upload — a policy violation, most likely — would look
    // like success, and a URL to a non-existent object would be persisted.
    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }
    if (!data) {
      throw new Error('Supabase Storage upload returned neither data nor error');
    }

    return {
      key: image.key,
      url: bucket.getPublicUrl(image.key).data.publicUrl,
    };
  }

  /**
   * Deletes the object a stored URL points at.
   *
   * The URL is reversed here rather than by the caller: this class produced it,
   * so it is the only place that should know how one is shaped. A URL that does
   * not belong to this bucket resolves to nothing and is left alone — guessing a
   * key from a foreign URL is how an unrelated object gets deleted.
   */
  async remove(storedUrl: string): Promise<void> {
    const key = this.keyFromUrl(storedUrl);
    if (key === null) return;

    const { data, error } = await this.client.storage.from(PUBLIC_PROFILE_BUCKET).remove([key]);

    // Raised rather than swallowed: the caller treats a failed cleanup as
    // non-fatal and logs it, which it can only do if it hears about it.
    if (error) {
      throw new Error(`Supabase Storage delete failed: ${error.message}`);
    }

    // Absence of an error is NOT evidence that anything was deleted, and this
    // is not a theoretical concern — it is what the gate caught. A delete that
    // matches no row (originally because the bucket had no SELECT policy, so the
    // lookup preceding the delete found nothing) removes nothing and reports
    // success. Checking only `error` meant every image replacement silently kept
    // its predecessor forever.
    //
    // The caller logs this without failing the save, so a misconfiguration
    // surfaces in the logs rather than as data quietly accumulating.
    if (!data || data.length === 0) {
      throw new Error(`Supabase Storage delete matched no object: ${key}`);
    }
  }

  private keyFromUrl(storedUrl: string): string | null {
    let url: URL;
    try {
      url = new URL(storedUrl);
    } catch {
      return null;
    }

    const prefix = `${PUBLIC_OBJECT_PATH}${PUBLIC_PROFILE_BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return null;

    // Everything after the bucket, not the last path segment: the key contains
    // its own slash separating the owner prefix from the filename.
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    return key.length === 0 ? null : key;
  }
}
