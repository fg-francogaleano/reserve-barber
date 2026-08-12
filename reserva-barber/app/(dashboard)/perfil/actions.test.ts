import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import {
  DuplicateSlugError,
  ProfileAlreadyExistsError,
  DuplicatePlatformError,
  UnsupportedImageTypeError,
  ImageTooLargeError,
  ImageUploadFailedError,
} from '@/server/domain/errors/BusinessProfileErrors';
import { INITIAL_PROFILE_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const saveProfile = vi.fn(async () => undefined);
const revalidatePath = vi.fn();
const loggerError = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));
vi.mock('./profileService', () => ({
  profileService: async () => ({ saveProfile, findProfile: vi.fn() }),
}));

const { saveBusinessProfileAction } = await import('./actions');

function form(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append('businessName', 'Barbería Don Juan');
  data.append('bio', '');
  data.append('publicSlug', 'barberia-don-juan');
  data.append('photoIntent', 'unchanged');
  data.append('coverIntent', 'unchanged');
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe('saveBusinessProfileAction - authentication precedes everything', () => {
  it('should_resolve_the_owner_before_touching_the_payload', async () => {
    requireOwner.mockRejectedValueOnce(new Error('no session'));

    // Server Actions carry no middleware protection by design — the guard
    // returns `continue` for any request with a `next-action` header — so this
    // call is the entire authorization boundary.
    await expect(saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form())).rejects.toThrow(
      'no session'
    );
    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe('saveBusinessProfileAction - success', () => {
  it('should_save_and_report_success_without_redirecting', async () => {
    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    // A singleton editor stays where it is. Unlike the create-then-list forms,
    // there is no list to go back to.
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(state.saved).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should_stamp_each_success_so_the_form_can_tell_one_from_the_next', async () => {
    const first = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());
    const second = await saveBusinessProfileAction(first, form());

    // `saved` is true after both, so only this distinguishes them — and the form
    // needs the distinction to return the image slots to "unchanged".
    expect(first.savedAt).not.toBeNull();
    expect(second.savedAt).not.toBeNull();
  });

  it('should_leave_the_stamp_empty_on_a_failure', async () => {
    saveProfile.mockRejectedValueOnce(new Error('connection lost'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.savedAt).toBeNull();
  });

  it('should_pass_the_owner_id_and_the_auth_user_id_separately', async () => {
    await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    const [ownerId, authUserId] = saveProfile.mock.calls[0] as unknown as [string, string];
    // The row is scoped by the domain owner id; the storage key must lead with
    // the auth id, because that is what the bucket policy compares.
    expect(ownerId).toBe('owner-root');
    expect(authUserId).toBe('auth-uuid');
  });

  it('should_revalidate_the_editor_so_the_saved_values_are_read_back', async () => {
    await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(revalidatePath).toHaveBeenCalledWith('/perfil');
  });

  it('should_refuse_to_act_for_an_owner_with_no_auth_user', async () => {
    requireOwner.mockResolvedValueOnce({
      id: 'owner-root',
      email: 'owner@example.com',
      authUserId: null,
    } as never);

    // Unreachable through the app — `requireOwner` resolves the owner *by*
    // their auth id — but the storage key cannot be composed without it, and
    // defaulting would write outside the policy's reach.
    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.error).toBeTruthy();
    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe('saveBusinessProfileAction - validation', () => {
  it('should_return_field_errors_without_saving', async () => {
    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ businessName: '' })
    );

    expect(state.fieldErrors.businessName).toBe(COPY.businessProfile.nameRequired);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('should_echo_the_submitted_values_back', async () => {
    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ businessName: '', bio: 'un texto que no quiero reescribir' })
    );

    expect(state.values.bio).toBe('un texto que no quiero reescribir');
  });

  it('should_echo_the_canonical_slug_on_success_not_the_text_that_was_typed', async () => {
    // The editor cannot normalize for itself — `slugify` runs server-side and
    // the client's suggestion is not authoritative. Without this the field keeps
    // the typed text, disagrees with the shareable link, and keeps the
    // link-breakage warning up after a save that changed nothing.
    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ publicSlug: 'Barberia Don Juan Centro' })
    );

    expect(state.saved).toBe(true);
    expect(state.values.publicSlug).toBe('barberia-don-juan-centro');
  });

  it('should_still_echo_the_raw_slug_when_the_save_is_rejected', async () => {
    // A rejected save is the one case where the owner needs their own text back
    // to correct it.
    saveProfile.mockRejectedValueOnce(new DuplicateSlugError('barberia-don-juan-centro'));

    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ publicSlug: 'Barberia Don Juan Centro' })
    );

    expect(state.saved).toBe(false);
    expect(state.values.publicSlug).toBe('Barberia Don Juan Centro');
  });

  it('should_collect_the_social_rows_from_repeated_fields', async () => {
    const data = form();
    data.append('socialPlatform', 'INSTAGRAM');
    data.append('socialUrl', 'https://instagram.com/a');
    data.append('socialPlatform', 'TIKTOK');
    data.append('socialUrl', 'https://tiktok.com/@a');

    await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, data);

    const [, , input] = saveProfile.mock.calls[0] as unknown as [
      string,
      string,
      { socialLinks: { platform: string }[] },
    ];
    expect(input.socialLinks.map((link) => link.platform)).toEqual(['INSTAGRAM', 'TIKTOK']);
  });

  it('should_never_report_success_alongside_a_validation_failure', async () => {
    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ publicSlug: '' })
    );

    expect(state.saved).toBe(false);
  });
});

describe('saveBusinessProfileAction - domain failures become messages', () => {
  it('should_report_a_taken_slug_on_the_slug_field_naming_the_normalized_value', async () => {
    saveProfile.mockRejectedValueOnce(new DuplicateSlugError('barberia-don-juan'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.fieldErrors.publicSlug).toBe(
      COPY.businessProfile.slugTaken('barberia-don-juan')
    );
  });

  it('should_not_report_a_second_profile_as_a_slug_problem', async () => {
    saveProfile.mockRejectedValueOnce(new ProfileAlreadyExistsError());

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    // The owner double-clicked save. Telling them their link is taken would be
    // a lie about a value they never changed.
    expect(state.error).toBe(COPY.businessProfile.alreadyExists);
    expect(state.fieldErrors.publicSlug).toBeUndefined();
  });

  it('should_report_a_duplicate_platform_at_set_level', async () => {
    saveProfile.mockRejectedValueOnce(new DuplicatePlatformError('INSTAGRAM'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.fieldErrors.socialLinksForm).toBe(COPY.businessProfile.socialDuplicatePlatform);
  });

  it('should_report_an_image_failure_on_the_slot_it_belongs_to', async () => {
    saveProfile.mockRejectedValueOnce(new UnsupportedImageTypeError('cover'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    // With two file inputs, an error that does not say which one leaves the
    // owner guessing.
    expect(state.fieldErrors.cover).toBe(COPY.businessProfile.imageUnsupportedType);
    expect(state.fieldErrors.photo).toBeUndefined();
  });

  it('should_report_an_oversized_image_on_its_own_slot', async () => {
    saveProfile.mockRejectedValueOnce(new ImageTooLargeError('photo'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.fieldErrors.photo).toBe(COPY.businessProfile.imageTooLarge);
  });

  it('should_report_an_upload_failure_as_an_infrastructure_problem', async () => {
    saveProfile.mockRejectedValueOnce(new ImageUploadFailedError('key', 'boom'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.error).toBe(COPY.businessProfile.imageUploadFailed);
  });
});

describe('saveBusinessProfileAction - unexpected failures', () => {
  it('should_report_a_generic_message_and_log_the_cause', async () => {
    saveProfile.mockRejectedValueOnce(new Error('connection lost'));

    const state = await saveBusinessProfileAction(INITIAL_PROFILE_FORM_STATE, form());

    expect(state.error).toBe(COPY.businessProfile.infrastructureError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('should_not_log_submitted_business_data', async () => {
    saveProfile.mockRejectedValueOnce(new Error('connection lost'));

    await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ bio: 'texto privado del dueño' })
    );

    // Design D11: a driver message embeds the submitted values, which would put
    // business data in the log stream and let crafted input forge log fields.
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('texto privado');
  });

  it('should_preserve_the_submitted_values_through_an_infrastructure_failure', async () => {
    saveProfile.mockRejectedValueOnce(new Error('connection lost'));

    const state = await saveBusinessProfileAction(
      INITIAL_PROFILE_FORM_STATE,
      form({ bio: 'no me borres' })
    );

    expect(state.values.bio).toBe('no me borres');
  });
});
