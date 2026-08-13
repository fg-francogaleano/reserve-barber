'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseSaveBusinessProfile } from '@/server/application/businessProfile/businessProfileSchema';
import {
  DuplicateSlugError,
  ProfileAlreadyExistsError,
  DuplicatePlatformError,
  UnsupportedImageTypeError,
  ImageTooLargeError,
  ImageUploadFailedError,
} from '@/server/domain/errors/BusinessProfileErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { profileService } from './profileService';
import { toFormState, type ProfileFormState, type ProfileFormValues } from './formState';

const PROFILE_PATH = '/perfil';

function read(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function readAll(formData: FormData, field: string): string[] {
  return formData.getAll(field).map((value) => (typeof value === 'string' ? value : ''));
}

/**
 * The social rows arrive as two parallel repeated fields rather than as indexed
 * names. Position is the pairing, which is also what `orderIndex` is derived
 * from — one source for both, so a row cannot pair with the wrong URL.
 */
function submittedValues(formData: FormData): ProfileFormValues {
  return {
    businessName: read(formData, 'businessName'),
    bio: read(formData, 'bio'),
    publicSlug: read(formData, 'publicSlug'),
    socialPlatforms: readAll(formData, 'socialPlatform'),
    socialUrls: readAll(formData, 'socialUrl'),
  };
}

function failure(state: Partial<ProfileFormState>, values: ProfileFormValues): ProfileFormState {
  return { error: null, fieldErrors: {}, saved: false, savedAt: null, values, ...state };
}

/**
 * Turns a domain error into something the owner can act on.
 *
 * Every branch here receives a **domain** type. The repository has already
 * translated the driver's unique violations, so nothing Prisma-shaped reaches
 * this file — see design D8 and `docs/tech-debt.md` T15.
 */
function toFailureState(error: unknown, values: ProfileFormValues): ProfileFormState {
  if (error instanceof DuplicateSlugError) {
    return failure(
      { fieldErrors: { publicSlug: COPY.businessProfile.slugTaken(error.slug) } },
      values
    );
  }

  if (error instanceof ProfileAlreadyExistsError) {
    // Only reachable through a race between two first-ever saves. Reporting it
    // on the slug field would blame a value the owner never changed.
    return failure({ error: COPY.businessProfile.alreadyExists }, values);
  }

  if (error instanceof DuplicatePlatformError) {
    // Validation rejects this before any write, so reaching it means a defect.
    // Reported at set level because the row index is not knowable here.
    return failure(
      { fieldErrors: { socialLinksForm: COPY.businessProfile.socialDuplicatePlatform } },
      values
    );
  }

  if (error instanceof UnsupportedImageTypeError) {
    return failure(
      { fieldErrors: { [error.slot]: COPY.businessProfile.imageUnsupportedType } },
      values
    );
  }

  if (error instanceof ImageTooLargeError) {
    return failure({ fieldErrors: { [error.slot]: COPY.businessProfile.imageTooLarge } }, values);
  }

  if (error instanceof ImageUploadFailedError) {
    logger.error('Image upload failed', {
      operation: 'saveBusinessProfile',
      key: error.key,
      cause: error.cause,
    });
    return failure({ error: COPY.businessProfile.imageUploadFailed }, values);
  }

  // Design D11: the driver's message embeds the submitted values, which would
  // put business data in the log stream and let a crafted name forge structured
  // log fields. Only the code and the operation are recorded.
  logger.error('Business profile write failed', toErrorLogContext('saveBusinessProfile', error));
  return failure({ error: COPY.businessProfile.infrastructureError }, values);
}

export async function saveBusinessProfileAction(
  _prevState: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action
  // through, so this is the entire authorization boundary for the action.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  // Unreachable through the application: `requireOwner` resolves the owner *by*
  // their auth id, so it is non-null by construction. Guarded rather than
  // asserted because the storage key leads with it, and a defaulted value would
  // write outside the reach of the bucket policy.
  if (owner.authUserId === null) {
    logger.error('Owner has no auth user id', { operation: 'saveBusinessProfile' });
    return failure({ error: COPY.businessProfile.infrastructureError }, values);
  }

  const parsed = parseSaveBusinessProfile({
    businessName: formData.get('businessName'),
    bio: formData.get('bio'),
    publicSlug: formData.get('publicSlug'),
    socialPlatforms: formData.getAll('socialPlatform'),
    socialUrls: formData.getAll('socialUrl'),
    photoIntent: formData.get('photoIntent'),
    photo: formData.get('photo'),
    coverIntent: formData.get('coverIntent'),
    cover: formData.get('cover'),
  });

  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    const service = await profileService();
    await service.saveProfile(owner.id, owner.authUserId, parsed.data);
  } catch (error) {
    return toFailureState(error, values);
  }

  // No redirect: this is a singleton editor, not a create-then-list form, so
  // there is nowhere to go.
  revalidatePath(PROFILE_PATH);

  // `savedAt` is what lets the form tell this success from the previous one, so
  // it can return the image slots to "unchanged". Without it a second save
  // still declares "replace" against an input the browser has emptied, fails
  // validation, and saves nothing — silently.
  //
  // The slug echoed back is the CANONICAL one, not what was submitted. The
  // editor cannot derive it — `slugify` runs here, and the client's suggestion
  // is not authoritative — so without this the field keeps the owner's raw text,
  // disagrees with the shareable link rendered beside it, and leaves the
  // link-breakage warning standing after a save that changed nothing. That
  // warning is the whole mitigation carried for `docs/tech-debt.md` T33 and must
  // not be spent on false alarms.
  //
  // Revalidating does NOT cover this, which is what the previous comment here
  // claimed: the case that exposed it never changes the stored value at all —
  // the typed text normalizes straight onto the slug already saved.
  return {
    error: null,
    fieldErrors: {},
    values: { ...values, publicSlug: parsed.data.publicSlug },
    saved: true,
    savedAt: Date.now(),
  };
}
