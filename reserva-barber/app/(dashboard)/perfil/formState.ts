import { COPY } from '@/lib/copy';
import type {
  BusinessProfileFieldError,
  BusinessProfileFieldErrors,
} from '@/server/application/businessProfile/businessProfileSchema';

/**
 * Everything the owner typed, echoed back verbatim.
 *
 * React 19 resets uncontrolled forms when an action resolves, so a rejected save
 * hands back an empty form unless every field survives here. That matters more
 * on this form than on the others: it carries a 1000-character bio.
 *
 * Files are deliberately absent. A `File` cannot be echoed back into an input,
 * so the form re-renders with the file pickers cleared, and the intent fields
 * fall back to "unchanged" — which is the safe reading. The owner re-picks the
 * image; they do not silently lose the stored one.
 */
export interface ProfileFormValues {
  businessName: string;
  bio: string;
  publicSlug: string;
  socialPlatforms: string[];
  socialUrls: string[];
}

export interface ProfileFormState {
  error: string | null;
  fieldErrors: {
    businessName?: string;
    bio?: string;
    publicSlug?: string;
    photo?: string;
    cover?: string;
    /** Keyed by submitted row index. */
    socialLinks?: Record<number, string>;
    socialLinksForm?: string;
  };
  values: ProfileFormValues;
  /** Drives the success state. Never true alongside an error. */
  saved: boolean;
  /**
   * When the save happened, as a token the form can compare against the last
   * one it reacted to.
   *
   * `saved` alone cannot serve: it is `true` after two consecutive saves, so the
   * form cannot tell a new success from the previous one — and it must, because
   * a success is what resets the image slots back to "unchanged". Leaving them
   * on "replace" after a save makes every later save fail validation with an
   * empty file input, silently (found by driving the editor on `workerd`).
   */
  savedAt: number | null;
}

export const EMPTY_PROFILE_FORM_VALUES: ProfileFormValues = {
  businessName: '',
  bio: '',
  publicSlug: '',
  socialPlatforms: [],
  socialUrls: [],
};

export const INITIAL_PROFILE_FORM_STATE: ProfileFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_PROFILE_FORM_VALUES,
  saved: false,
  savedAt: null,
};

function nameMessage(code: BusinessProfileFieldError): string {
  return code === 'required' ? COPY.businessProfile.nameRequired : COPY.businessProfile.nameLength;
}

function slugMessage(code: BusinessProfileFieldError): string {
  return code === 'required' ? COPY.businessProfile.slugRequired : COPY.businessProfile.slugTooShort;
}

/**
 * Each social failure gets its own message. Collapsing them would tell an owner
 * who repeated a platform that their link is "invalid", which explains the wrong
 * thing — the same reasoning the price parser follows in the services form.
 */
function socialMessage(code: BusinessProfileFieldError): string {
  switch (code) {
    case 'required':
      return COPY.businessProfile.socialIncomplete;
    case 'unknown_platform':
      return COPY.businessProfile.socialUnknownPlatform;
    case 'duplicate_platform':
      return COPY.businessProfile.socialDuplicatePlatform;
    case 'invalid_protocol':
      return COPY.businessProfile.socialInvalidProtocol;
    case 'too_long':
      return COPY.businessProfile.socialUrlTooLong;
    default:
      return COPY.businessProfile.socialInvalidUrl;
  }
}

function imageMessage(code: BusinessProfileFieldError): string {
  // `required` here means the form declared a replacement and sent no file —
  // nothing was uploaded, so "the upload failed" would describe an attempt that
  // never happened.
  return code === 'required'
    ? COPY.businessProfile.imageReselect
    : COPY.businessProfile.imageUnsupportedType;
}

function socialRowMessages(
  rows: Record<number, BusinessProfileFieldError>
): Record<number, string> {
  const messages: Record<number, string> = {};
  for (const [index, code] of Object.entries(rows)) {
    messages[Number(index)] = socialMessage(code);
  }
  return messages;
}

export function toFormState(
  fieldErrors: BusinessProfileFieldErrors,
  values: ProfileFormValues
): ProfileFormState {
  return {
    error: null,
    fieldErrors: {
      ...(fieldErrors.businessName ? { businessName: nameMessage(fieldErrors.businessName) } : {}),
      ...(fieldErrors.bio ? { bio: COPY.businessProfile.bioTooLong } : {}),
      ...(fieldErrors.publicSlug ? { publicSlug: slugMessage(fieldErrors.publicSlug) } : {}),
      ...(fieldErrors.photo ? { photo: imageMessage(fieldErrors.photo) } : {}),
      ...(fieldErrors.cover ? { cover: imageMessage(fieldErrors.cover) } : {}),
      ...(fieldErrors.socialLinks
        ? { socialLinks: socialRowMessages(fieldErrors.socialLinks) }
        : {}),
      ...(fieldErrors.socialLinksForm
        ? { socialLinksForm: COPY.businessProfile.socialTooMany }
        : {}),
    },
    values,
    saved: false,
    savedAt: null,
  };
}
