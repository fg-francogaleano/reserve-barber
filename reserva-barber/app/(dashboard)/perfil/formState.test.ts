import { describe, it, expect } from 'vitest';
import { toFormState, INITIAL_PROFILE_FORM_STATE, type ProfileFormValues } from './formState';
import { COPY } from '@/lib/copy';

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    businessName: 'Barbería Don Juan',
    bio: 'Cortes clásicos',
    publicSlug: 'barberia-don-juan',
    socialPlatforms: ['INSTAGRAM'],
    socialUrls: ['https://instagram.com/a'],
    ...overrides,
  };
}

describe('INITIAL_PROFILE_FORM_STATE', () => {
  it('starts with nothing to report', () => {
    expect(INITIAL_PROFILE_FORM_STATE.error).toBeNull();
    expect(INITIAL_PROFILE_FORM_STATE.fieldErrors).toEqual({});
    expect(INITIAL_PROFILE_FORM_STATE.saved).toBe(false);
  });
});

describe('toFormState', () => {
  it('maps a missing name to its own message rather than a length one', () => {
    const state = toFormState({ businessName: 'required' }, values());
    expect(state.fieldErrors.businessName).toBe(COPY.businessProfile.nameRequired);
  });

  it('maps a bad name length to the length message', () => {
    const state = toFormState({ businessName: 'invalid_length' }, values());
    expect(state.fieldErrors.businessName).toBe(COPY.businessProfile.nameLength);
  });

  it('maps an over-long bio', () => {
    const state = toFormState({ bio: 'too_long' }, values());
    expect(state.fieldErrors.bio).toBe(COPY.businessProfile.bioTooLong);
  });

  it('distinguishes a missing slug from one that is too short', () => {
    expect(toFormState({ publicSlug: 'required' }, values()).fieldErrors.publicSlug).toBe(
      COPY.businessProfile.slugRequired
    );
    expect(toFormState({ publicSlug: 'invalid_length' }, values()).fieldErrors.publicSlug).toBe(
      COPY.businessProfile.slugTooShort
    );
  });

  it('keys social errors by row so the editor can mark the right one', () => {
    const state = toFormState({ socialLinks: { 1: 'duplicate_platform' } }, values());

    expect(state.fieldErrors.socialLinks?.[1]).toBe(COPY.businessProfile.socialDuplicatePlatform);
    expect(state.fieldErrors.socialLinks?.[0]).toBeUndefined();
  });

  it('gives each social failure its own message', () => {
    const cases = [
      ['required', COPY.businessProfile.socialIncomplete],
      ['unknown_platform', COPY.businessProfile.socialUnknownPlatform],
      ['duplicate_platform', COPY.businessProfile.socialDuplicatePlatform],
      ['invalid_protocol', COPY.businessProfile.socialInvalidProtocol],
      ['invalid_format', COPY.businessProfile.socialInvalidUrl],
      ['too_long', COPY.businessProfile.socialUrlTooLong],
    ] as const;

    for (const [code, message] of cases) {
      const state = toFormState({ socialLinks: { 0: code } }, values());
      expect(state.fieldErrors.socialLinks?.[0]).toBe(message);
    }
  });

  it('reports a set-level failure separately from any row', () => {
    const state = toFormState({ socialLinksForm: 'too_many' }, values());

    expect(state.fieldErrors.socialLinksForm).toBe(COPY.businessProfile.socialTooMany);
    expect(state.fieldErrors.socialLinks).toBeUndefined();
  });

  it('maps image failures per slot', () => {
    const state = toFormState({ photo: 'required', cover: 'invalid_format' }, values());

    expect(state.fieldErrors.photo).toBeDefined();
    expect(state.fieldErrors.cover).toBeDefined();
  });

  it('echoes every submitted value back so a rejected form is not handed back empty', () => {
    // React 19 resets uncontrolled forms on resolve, so anything the owner typed
    // is lost unless the action returns it.
    const submitted = values({ bio: 'un texto largo que no quiero volver a escribir' });

    const state = toFormState({ businessName: 'required' }, submitted);

    expect(state.values).toEqual(submitted);
  });

  it('reports several fields at once', () => {
    const state = toFormState(
      { businessName: 'required', publicSlug: 'required', bio: 'too_long' },
      values()
    );

    expect(Object.keys(state.fieldErrors).length).toBeGreaterThanOrEqual(3);
  });

  it('never reports success alongside a field error', () => {
    const state = toFormState({ businessName: 'required' }, values());
    expect(state.saved).toBe(false);
  });
});
