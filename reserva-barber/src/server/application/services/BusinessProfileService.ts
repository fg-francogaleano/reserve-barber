import type { BusinessProfile } from '@/server/domain/models/BusinessProfile';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IImageStorage, ImageContentType } from '@/server/domain/repositories/IImageStorage';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { detectImageType, extensionFor, MAX_IMAGE_BYTES } from '@/server/domain/models/imageType';
import {
  UnsupportedImageTypeError,
  ImageTooLargeError,
  ImageUploadFailedError,
  type ImageSlot,
} from '@/server/domain/errors/BusinessProfileErrors';
import type {
  SaveBusinessProfileInput,
  ImageIntent,
} from '@/server/application/businessProfile/businessProfileSchema';

/** An intent with its file already read and verified, but nothing uploaded yet. */
type PreparedImage =
  | { kind: 'unchanged' }
  | { kind: 'remove' }
  | { kind: 'replace'; bytes: Uint8Array; contentType: ImageContentType };

interface ResolvedImage {
  /** What to persist: a new URL, the previous one, or `null`. */
  url: string | null;
  /** The previous object to delete once the save commits, if any. */
  supersededUrl: string | null;
  /** Set when something was uploaded — needed to report an orphan. */
  uploadedKey: string | null;
}

export class BusinessProfileService {
  constructor(
    private readonly profiles: IBusinessProfileRepository,
    private readonly images: IImageStorage,
    private readonly logger: ILogger
  ) {}

  findProfile(ownerId: string): Promise<BusinessProfile | null> {
    return this.profiles.findByOwner(ownerId);
  }

  /**
   * Saves the whole form.
   *
   * The order is the design, not an implementation detail:
   *
   * 1. **Validate both images.** Rejecting the cover after the photo has already
   *    been uploaded would orphan an object for a failure that was visible
   *    before either upload started.
   * 2. **Upload, before any transaction opens.** Storage is not transactional
   *    and a network round trip must not hold a database transaction open on a
   *    pooled connection (design D6).
   * 3. **Write.** If this fails, whatever was uploaded is unreferenced: it is
   *    logged with its key and left. There is no reaper — reclaiming a few
   *    hundred kilobytes must never be the reason a save fails
   *    (`docs/tech-debt.md` T32).
   * 4. **Delete superseded objects, best effort.** After the commit, never
   *    before: deleting first would destroy a live image if the write then
   *    failed.
   *
   * `authUserId` is separate from `ownerId` and both are needed. The object key
   * must lead with the *auth* id, because that is what the bucket policy
   * compares against the session; the row is scoped by the *domain* owner id.
   * Passing one where the other belongs makes every upload fail (design D5/D13).
   */
  async saveProfile(
    ownerId: string,
    authUserId: string,
    input: SaveBusinessProfileInput
  ): Promise<BusinessProfile> {
    const existing = await this.profiles.findByOwner(ownerId);

    const prepared = {
      photo: await prepareImage(input.photo, 'photo'),
      cover: await prepareImage(input.cover, 'cover'),
    };

    const photo = await this.resolveImage(authUserId, 'photo', prepared.photo, existing?.photoUrl ?? null);
    const cover = await this.resolveImage(authUserId, 'cover', prepared.cover, existing?.coverUrl ?? null);

    let saved: BusinessProfile;
    try {
      saved = await this.profiles.save(ownerId, {
        businessName: input.businessName,
        bio: input.bio,
        publicSlug: input.publicSlug,
        photoUrl: photo.url,
        coverUrl: cover.url,
        socialLinks: input.socialLinks,
      });
    } catch (error) {
      this.reportOrphans([photo.uploadedKey, cover.uploadedKey], error);
      throw error;
    }

    await this.deleteSuperseded([photo.supersededUrl, cover.supersededUrl]);

    return saved;
  }

  private async resolveImage(
    authUserId: string,
    slot: ImageSlot,
    prepared: PreparedImage,
    storedUrl: string | null
  ): Promise<ResolvedImage> {
    if (prepared.kind === 'unchanged') {
      return { url: storedUrl, supersededUrl: null, uploadedKey: null };
    }

    if (prepared.kind === 'remove') {
      return { url: null, supersededUrl: storedUrl, uploadedKey: null };
    }

    const key = objectKey(authUserId, slot, prepared.contentType);

    try {
      const stored = await this.images.upload({
        key,
        bytes: prepared.bytes,
        contentType: prepared.contentType,
      });
      return { url: stored.url, supersededUrl: storedUrl, uploadedKey: stored.key };
    } catch (error) {
      // The provider's message is not propagated as-is: it embeds request
      // details, and the same rule that keeps submitted values out of database
      // diagnostics applies here.
      throw new ImageUploadFailedError(key, error instanceof Error ? error.message : String(error));
    }
  }

  private reportOrphans(keys: (string | null)[], cause: unknown): void {
    for (const key of keys) {
      if (key === null) continue;
      this.logger.error('Uploaded image is unreferenced after a failed profile save', {
        operation: 'saveProfile',
        key,
        cause: cause instanceof Error ? cause.name : 'unknown',
      });
    }
  }

  private async deleteSuperseded(urls: (string | null)[]): Promise<void> {
    for (const url of urls) {
      if (url === null) continue;
      try {
        await this.images.remove(url);
      } catch (error) {
        this.logger.error('Could not delete a superseded image', {
          operation: 'saveProfile',
          url,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Reads and verifies a file without uploading it.
 *
 * The type comes from the leading bytes, never from `File.type` or the
 * extension: both are client-controlled and prove nothing. The size bound is
 * re-checked here even though the browser downscales and the bucket also
 * refuses oversized objects — the client runs in an environment we do not
 * control, so its work is an optimisation, not a validation.
 */
async function prepareImage(intent: ImageIntent, slot: ImageSlot): Promise<PreparedImage> {
  if (intent.intent === 'unchanged') return { kind: 'unchanged' };
  if (intent.intent === 'remove') return { kind: 'remove' };

  const bytes = new Uint8Array(await intent.file.arrayBuffer());

  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageTooLargeError(slot);

  const contentType = detectImageType(bytes);
  if (contentType === null) throw new UnsupportedImageTypeError(slot);

  return { kind: 'replace', bytes, contentType };
}

/**
 * Every segment server-held: the session's auth user id, a fixed slot name, a
 * timestamp, and an extension derived from the detected type.
 *
 * Nothing here derives from the uploaded file's name. Storage keys accept path
 * separators, so a filename reaching the key could write outside the owner's
 * prefix. The timestamp also guarantees a replacement never reuses a key, so no
 * cache can serve the previous image under the new URL (design D5).
 */
function objectKey(authUserId: string, slot: ImageSlot, contentType: ImageContentType): string {
  return `${authUserId}/${slot}-${Date.now()}.${extensionFor(contentType)}`;
}
