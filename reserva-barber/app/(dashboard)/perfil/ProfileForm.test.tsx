import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm, type ProfileFormAction } from './ProfileForm';
import { INITIAL_PROFILE_FORM_STATE, type ProfileFormState } from './formState';
import { COPY } from '@/lib/copy';
import type { ImagePipeline } from '@/lib/imagePipeline';

function pipeline(overrides: Partial<ImagePipeline> = {}): ImagePipeline {
  return {
    process: vi.fn(async (file: File) => file),
    attach: vi.fn(),
    previewUrl: vi.fn(() => 'blob:preview'),
    revokePreview: vi.fn(),
    ...overrides,
  };
}

function resolvedAction(state: Partial<ProfileFormState> = {}) {
  return vi.fn(async () => ({ ...INITIAL_PROFILE_FORM_STATE, ...state }));
}

function pngFile(name = 'photo.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
}

beforeEach(() => vi.clearAllMocks());

describe('ProfileForm - the fields', () => {
  it('renders the stored values as defaults', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{
          businessName: 'Barbería Don Juan',
          bio: 'Cortes clásicos',
          publicSlug: 'barberia-don-juan',
          photoUrl: null,
          coverUrl: null,
          socialLinks: [],
        }}
      />
    );

    expect(screen.getByLabelText(COPY.businessProfile.businessNameLabel)).toHaveValue(
      'Barbería Don Juan'
    );
    expect(screen.getByLabelText(COPY.businessProfile.bioLabel)).toHaveValue('Cortes clásicos');
  });

  it('associates a field error with its input', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={emptyDefaults()}
        initialState={{
          ...INITIAL_PROFILE_FORM_STATE,
          fieldErrors: { businessName: COPY.businessProfile.nameRequired },
        }}
      />
    );

    const input = screen.getByLabelText(COPY.businessProfile.businessNameLabel);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(COPY.businessProfile.nameRequired);
  });

  it('shows a general error', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={emptyDefaults()}
        initialState={{
          ...INITIAL_PROFILE_FORM_STATE,
          error: COPY.businessProfile.infrastructureError,
        }}
      />
    );

    expect(screen.getByText(COPY.businessProfile.infrastructureError)).toBeInTheDocument();
  });

  it('confirms a successful save', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={emptyDefaults()}
        initialState={{ ...INITIAL_PROFILE_FORM_STATE, saved: true }}
      />
    );

    expect(screen.getByText(COPY.businessProfile.saved)).toBeInTheDocument();
  });
});

describe('ProfileForm - the slug', () => {
  it('suggests a slug from the business name while none has been saved', async () => {
    const user = userEvent.setup();
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    await user.type(screen.getByLabelText(COPY.businessProfile.businessNameLabel), 'Barbería Don Juan');

    expect(screen.getByLabelText(COPY.businessProfile.slugLabel)).toHaveValue('barberia-don-juan');
  });

  it('stops suggesting once the owner edits the slug themselves', async () => {
    const user = userEvent.setup();
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    const slug = screen.getByLabelText(COPY.businessProfile.slugLabel);
    await user.type(slug, 'mi-barberia');
    await user.type(screen.getByLabelText(COPY.businessProfile.businessNameLabel), 'Otro Nombre');

    // Overwriting a slug the owner chose would silently change the URL they are
    // about to share.
    expect(slug).toHaveValue('mi-barberia');
  });

  it('never overwrites a slug that was already saved', async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), publicSlug: 'barberia-don-juan' }}
      />
    );

    await user.type(screen.getByLabelText(COPY.businessProfile.businessNameLabel), 'Nombre Nuevo');

    expect(screen.getByLabelText(COPY.businessProfile.slugLabel)).toHaveValue('barberia-don-juan');
  });

  it('warns when a saved slug is altered', async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), publicSlug: 'barberia-don-juan' }}
      />
    );

    await user.type(screen.getByLabelText(COPY.businessProfile.slugLabel), '-nuevo');

    // The only moment the warning can be acted on: there is no way to learn
    // afterwards who holds the old link.
    expect(screen.getByText(COPY.businessProfile.slugChangeWarning)).toBeInTheDocument();
  });

  it('adopts the canonical slug once the save succeeds and drops the warning', async () => {
    // Reproduces what adversarial review found on the deployed Worker: typing a
    // slug that normalizes onto the ALREADY STORED value saved fine and left the
    // red "your shared links stopped working" warning on screen, with the field
    // and the shareable link disagreeing. The stored slug never changed, so
    // watching `defaults` for a change cannot catch this — the canonical value
    // has to come back from the action.
    const user = userEvent.setup();
    const stored = 'barberia-don-juan-centro';
    const action = vi.fn<ProfileFormAction>(async () => ({
      ...INITIAL_PROFILE_FORM_STATE,
      saved: true,
      savedAt: 1_700_000_000_000,
      values: {
        businessName: 'Barbería Don Juan',
        bio: '',
        publicSlug: stored,
        socialPlatforms: [],
        socialUrls: [],
      },
    }));

    render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería Don Juan', publicSlug: stored }}
      />
    );

    const field = screen.getByLabelText(COPY.businessProfile.slugLabel);
    await user.clear(field);
    await user.type(field, 'Barberia Don Juan Centro');
    expect(screen.getByText(COPY.businessProfile.slugChangeWarning)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));

    await waitFor(() => expect(field).toHaveValue(stored));
    expect(screen.queryByText(COPY.businessProfile.slugChangeWarning)).not.toBeInTheDocument();
  });

  it('does not warn while choosing a slug for the first time', async () => {
    const user = userEvent.setup();
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    await user.type(screen.getByLabelText(COPY.businessProfile.slugLabel), 'mi-barberia');

    expect(screen.queryByText(COPY.businessProfile.slugChangeWarning)).toBeNull();
  });

  it('does not warn when the saved slug is restored', async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), publicSlug: 'barberia' }}
      />
    );

    const slug = screen.getByLabelText(COPY.businessProfile.slugLabel);
    await user.type(slug, 'x');
    await user.clear(slug);
    await user.type(slug, 'barberia');

    expect(screen.queryByText(COPY.businessProfile.slugChangeWarning)).toBeNull();
  });
});

describe('ProfileForm - images', () => {
  it('processes a chosen file and writes the result back into the input', async () => {
    const processed = pngFile('processed.webp');
    const pipe = pipeline({ process: vi.fn(async () => processed) });
    const user = userEvent.setup();

    render(<ProfileForm action={resolvedAction()} pipeline={pipe} defaults={emptyDefaults()} />);

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());

    await waitFor(() => expect(pipe.process).toHaveBeenCalled());
    // Submitting the original would send the multi-megabyte photograph the
    // framework's body limit then rejects.
    await waitFor(() => expect(pipe.attach).toHaveBeenCalledWith(expect.anything(), processed));
  });

  it('marks the slot as replace only after a file is chosen', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />
    );

    const intent = () =>
      container.querySelector<HTMLInputElement>('input[name="photoIntent"]')?.value;

    expect(intent()).toBe('unchanged');
    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());
    await waitFor(() => expect(intent()).toBe('replace'));
  });

  it('marks the slot as remove when the owner removes a stored image', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), photoUrl: 'https://cdn/photo.png' }}
      />
    );

    await user.click(screen.getAllByRole('button', { name: COPY.businessProfile.imageRemove })[0]);

    expect(container.querySelector<HTMLInputElement>('input[name="photoIntent"]')?.value).toBe(
      'remove'
    );
  });

  it('shows a preview at the aspect ratio the public page will use', async () => {
    const user = userEvent.setup();
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    await user.upload(screen.getByLabelText(COPY.businessProfile.coverLabel), pngFile());

    // With no crop tool, the preview is the only place a mismatched image can be
    // caught — so it must not flatter the result.
    const preview = await screen.findByAltText(COPY.businessProfile.coverLabel);
    expect(preview.closest('[data-slot-frame]')?.className).toContain('aspect-');
  });

  it('revokes the previous preview when the image is replaced again', async () => {
    const pipe = pipeline();
    const user = userEvent.setup();

    render(<ProfileForm action={resolvedAction()} pipeline={pipe} defaults={emptyDefaults()} />);

    const input = screen.getByLabelText(COPY.businessProfile.photoLabel);
    await user.upload(input, pngFile('one.png'));
    await waitFor(() => expect(pipe.previewUrl).toHaveBeenCalledTimes(1));
    await user.upload(input, pngFile('two.png'));

    await waitFor(() => expect(pipe.revokePreview).toHaveBeenCalledWith('blob:preview'));
  });

  it('reports a file the browser cannot read, without marking the slot as replaced', async () => {
    const pipe = pipeline({ process: vi.fn().mockRejectedValue(new Error('undecodable')) });
    const user = userEvent.setup();

    const { container } = render(
      <ProfileForm action={resolvedAction()} pipeline={pipe} defaults={emptyDefaults()} />
    );

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());

    expect(await screen.findByText(COPY.businessProfile.imageUndecodable)).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[name="photoIntent"]')?.value).toBe(
      'unchanged'
    );
  });

  it('discloses the metadata and permanence caveats before an upload happens', () => {
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    expect(screen.getAllByText(COPY.businessProfile.imagePrivacyNote).length).toBeGreaterThan(0);
  });
});

describe('ProfileForm - social links', () => {
  it('starts with the stored links', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{
          ...emptyDefaults(),
          socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/a' }],
        }}
      />
    );

    expect(screen.getByDisplayValue('https://instagram.com/a')).toBeInTheDocument();
  });

  it('says so when there are none', () => {
    render(<ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />);

    expect(screen.getByText(COPY.businessProfile.socialEmpty)).toBeInTheDocument();
  });

  it('adds and removes rows', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProfileForm action={resolvedAction()} pipeline={pipeline()} defaults={emptyDefaults()} />
    );

    const rows = () => container.querySelectorAll('input[name="socialUrl"]').length;

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.socialAdd }));
    expect(rows()).toBe(1);

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.socialRemove }));
    expect(rows()).toBe(0);
  });

  it('marks the offending row rather than the whole set', () => {
    render(
      <ProfileForm
        action={resolvedAction()}
        pipeline={pipeline()}
        defaults={{
          ...emptyDefaults(),
          socialLinks: [
            { platform: 'INSTAGRAM', url: 'https://instagram.com/a' },
            { platform: 'INSTAGRAM', url: 'https://instagram.com/b' },
          ],
        }}
        initialState={{
          ...INITIAL_PROFILE_FORM_STATE,
          fieldErrors: { socialLinks: { 1: COPY.businessProfile.socialDuplicatePlatform } },
        }}
      />
    );

    expect(screen.getByText(COPY.businessProfile.socialDuplicatePlatform)).toBeInTheDocument();
  });
});

describe('ProfileForm - the form is closed while an image is being prepared', () => {
  // Regression. The slot only moves to "replace" once the client has re-encoded
  // the file, and until then the input holds the ORIGINAL while the intent still
  // reads "unchanged". Submitting in that gap sends both: the action obeys the
  // intent, ignores the file, saves everything else and reports success — a
  // confirmation for a replacement that never happened. Measured at 1,689 ms on
  // `workerd` with a 2400x1800 PNG, with the button enabled the whole time.
  function deferredPipeline(): ImagePipeline & { finish: () => void } {
    let release!: (file: File) => void;
    const pending = new Promise<File>((resolve) => {
      release = resolve;
    });
    return {
      process: vi.fn(() => pending),
      attach: vi.fn(),
      previewUrl: vi.fn(() => 'blob:preview'),
      revokePreview: vi.fn(),
      finish: () => release(pngFile('upload.webp')),
    };
  }

  it('refuses to submit and discloses the preparation while it runs', async () => {
    const user = userEvent.setup();
    const action = resolvedAction();
    const image = deferredPipeline();

    render(
      <ProfileForm
        action={action}
        pipeline={image}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());

    const save = screen.getByRole('button', { name: COPY.businessProfile.save });
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText(COPY.businessProfile.imageProcessing)).toBeInTheDocument();

    // The save the owner would have lost.
    await user.click(save);
    expect(action).not.toHaveBeenCalled();
  });

  it('releases the form once every slot has settled', async () => {
    const user = userEvent.setup();
    const action = resolvedAction();
    const image = deferredPipeline();

    render(
      <ProfileForm
        action={action}
        pipeline={image}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.businessProfile.save })).toBeDisabled()
    );

    image.finish();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.businessProfile.save })).toBeEnabled()
    );
    expect(screen.queryByText(COPY.businessProfile.imageProcessing)).not.toBeInTheDocument();
  });
});

describe('ProfileForm - social rows survive an action boundary', () => {
  // Regression, and a nastier one than it looks. React 19 resets an uncontrolled
  // form once its action resolves, so a row added during the session reverted to
  // the blank it was created with. Blank rows are discarded as absence, and D7
  // replaces the link set wholesale — so the *next* save deleted a link the owner
  // had already stored, with nothing on screen to suggest it. Reproduced by hand
  // on `next dev`: added WHATSAPP, saved, pressed save again touching nothing,
  // and the link was gone from the database.
  it('submits a row added during the session again on the next save', async () => {
    const user = userEvent.setup();
    // Typed by signature so the submitted FormData can be read back off the call
    // record — this test asserts on what the *second* save puts on the wire.
    //
    // The success state carries the canonical slug because the real action does:
    // the form adopts it, and a success echoing an empty one would blank the
    // field and let the browser's `required` block the second submit.
    const action = vi.fn<ProfileFormAction>(async () => ({
      ...INITIAL_PROFILE_FORM_STATE,
      saved: true,
      savedAt: 1_700_000_000_000,
      values: { ...INITIAL_PROFILE_FORM_STATE.values, publicSlug: 'barberia' },
    }));

    render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.socialAdd }));
    await user.selectOptions(screen.getByLabelText(COPY.businessProfile.socialPlatformLabel), 'WHATSAPP');
    await user.type(screen.getByLabelText(COPY.businessProfile.socialUrlLabel), 'https://wa.me/1');

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    // Nothing is touched between the two saves. This is the owner pressing save
    // twice, which must be idempotent.
    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));

    const submitted = action.mock.calls[1][1];
    expect(submitted.getAll('socialPlatform')).toEqual(['WHATSAPP']);
    expect(submitted.getAll('socialUrl')).toEqual(['https://wa.me/1']);
  });

  it('keeps the values the owner typed when the save is rejected', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      ...INITIAL_PROFILE_FORM_STATE,
      error: COPY.businessProfile.infrastructureError,
    }));

    render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{
          ...emptyDefaults(),
          businessName: 'Barbería',
          publicSlug: 'barberia',
          socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/a' }],
        }}
      />
    );

    const url = screen.getByLabelText(COPY.businessProfile.socialUrlLabel);
    await user.clear(url);
    await user.type(url, 'https://instagram.com/corregido');

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));
    await screen.findByText(COPY.businessProfile.infrastructureError);

    // Reverting here would hand the owner a form that disagrees with what they
    // just submitted, and their retry would store the stale value.
    expect(screen.getByDisplayValue('https://instagram.com/corregido')).toBeInTheDocument();
  });
});

describe('ProfileForm - a save returns the image slots to unchanged', () => {
  // Regression: after the first successful save the slot stayed on "replace"
  // while the browser emptied the file input, so every later save declared a
  // replacement with no file, failed validation, and saved nothing — with an
  // error pointing at an image the owner had not touched. Only visible by
  // driving the real editor.
  it('resets a replaced slot once the save reports success', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      ...INITIAL_PROFILE_FORM_STATE,
      saved: true,
      savedAt: 1_700_000_000_000,
    }));

    const { container } = render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    const intent = () =>
      container.querySelector<HTMLInputElement>('input[name="photoIntent"]')?.value;

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());
    await waitFor(() => expect(intent()).toBe('replace'));

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));

    await waitFor(() => expect(intent()).toBe('unchanged'));
  });

  it('does not reset the slots when the save failed', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      ...INITIAL_PROFILE_FORM_STATE,
      error: COPY.businessProfile.infrastructureError,
    }));

    const { container } = render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    await user.upload(screen.getByLabelText(COPY.businessProfile.photoLabel), pngFile());
    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));

    // The owner's pick must survive a failure, or their retry silently drops the
    // image they chose.
    await screen.findByText(COPY.businessProfile.infrastructureError);
    expect(container.querySelector<HTMLInputElement>('input[name="photoIntent"]')?.value).toBe(
      'replace'
    );
  });
});

describe('ProfileForm - submitting', () => {
  it('warns the owner not to close the tab while it saves', async () => {
    // An upload through a Server Action cannot report progress, so several
    // seconds on a mobile connection looks like a frozen page without this.
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<ProfileFormState>((resolve) => {
          release = () => resolve(INITIAL_PROFILE_FORM_STATE);
        })
    );

    render(
      <ProfileForm
        action={action}
        pipeline={pipeline()}
        defaults={{ ...emptyDefaults(), businessName: 'Barbería', publicSlug: 'barberia' }}
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.businessProfile.save }));

    expect(await screen.findByText(COPY.businessProfile.savingHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.businessProfile.saving })).toBeDisabled();

    release?.();
  });
});

function emptyDefaults() {
  return {
    businessName: '',
    bio: '',
    publicSlug: '',
    photoUrl: null,
    coverUrl: null,
    socialLinks: [] as { platform: string; url: string }[],
  };
}
