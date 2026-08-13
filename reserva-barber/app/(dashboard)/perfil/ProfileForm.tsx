'use client';

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { COPY } from '@/lib/copy';
import { slugify } from '@/server/domain/models/slugify';
import { SOCIAL_PLATFORMS } from '@/server/domain/models/BusinessProfile';
import { createBrowserImagePipeline, type ImagePipeline } from '@/lib/imagePipeline';
import { INITIAL_PROFILE_FORM_STATE, type ProfileFormState } from './formState';

export type ProfileFormAction = (
  state: ProfileFormState,
  formData: FormData
) => Promise<ProfileFormState>;

export interface ProfileFormDefaults {
  businessName: string;
  bio: string;
  publicSlug: string;
  photoUrl: string | null;
  coverUrl: string | null;
  socialLinks: { platform: string; url: string }[];
}

interface ProfileFormProps {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: ProfileFormAction;
  /**
   * Optional, and injected for the same reason: none of it exists outside a
   * browser. The page cannot pass one — a Server Component cannot send methods
   * across the boundary — so the browser implementation is built here when it is
   * absent, and tests supply a fake.
   */
  pipeline?: ImagePipeline;
  defaults: ProfileFormDefaults;
  initialState?: ProfileFormState;
}

type SlotName = 'photo' | 'cover';
type Intent = 'unchanged' | 'replace' | 'remove';

interface SlotState {
  intent: Intent;
  previewUrl: string | null;
  error: string | null;
  /**
   * True from the moment a file is chosen until the client has re-encoded it.
   *
   * The window is real and long enough to lose work in: the input already holds
   * the original file while `intent` still reads `unchanged`, so a save sent
   * during it carries both, and the action obeys the intent and drops the
   * replacement while reporting success (design D4).
   */
  preparing: boolean;
}

const EMPTY_SLOT: SlotState = {
  intent: 'unchanged',
  previewUrl: null,
  error: null,
  preparing: false,
};

/** Photo is shown as a circle-ish square; the cover is a wide band. */
const SLOT_ASPECT: Record<SlotName, string> = {
  photo: 'aspect-square w-32',
  cover: 'aspect-[3/1] w-full',
};

const SLOT_LABEL: Record<SlotName, string> = {
  photo: COPY.businessProfile.photoLabel,
  cover: COPY.businessProfile.coverLabel,
};

export function ProfileForm({
  action,
  pipeline: injectedPipeline,
  defaults,
  initialState,
}: ProfileFormProps) {
  // Built once, lazily: constructing it during every render would discard the
  // renderer on each keystroke for no benefit.
  const [pipeline] = useState(() => injectedPipeline ?? createBrowserImagePipeline());

  const [state, formAction, isPending] = useActionState(action, {
    ...(initialState ?? INITIAL_PROFILE_FORM_STATE),
    values: {
      businessName: defaults.businessName,
      bio: defaults.bio,
      publicSlug: defaults.publicSlug,
      socialPlatforms: defaults.socialLinks.map((link) => link.platform),
      socialUrls: defaults.socialLinks.map((link) => link.url),
    },
  });

  const [businessName, setBusinessName] = useState(defaults.businessName);
  const [slug, setSlug] = useState(defaults.publicSlug);
  // Once the owner edits the slug, the suggestion stops following the name.
  // Overwriting a slug they chose would silently change the URL they are about
  // to share. A slug that was already saved counts as chosen.
  const [slugTouched, setSlugTouched] = useState(defaults.publicSlug.length > 0);

  const [slots, setSlots] = useState<Record<SlotName, SlotState>>({
    photo: EMPTY_SLOT,
    cover: EMPTY_SLOT,
  });

  // Controlled, unlike the other optional fields.
  //
  // React 19 resets an uncontrolled form once its action resolves, restoring
  // every field to the `defaultValue` of the render that follows. These rows are
  // rendered from state that was seeded at mount, so a row added or edited during
  // the session reverted the moment a save succeeded — and because a blank row is
  // discarded as absence while D7 replaces the link set wholesale, the next save
  // deleted a link the owner had already stored. Holding the values in state
  // makes the reset a no-op: React re-renders them straight back.
  const [socialRows, setSocialRows] = useState(defaults.socialLinks);

  function updateSocialRow(index: number, patch: Partial<{ platform: string; url: string }>): void {
    setSocialRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // Controlling the value is enough for the URL inputs but NOT for the platform
  // selects, which is the part of this that only measurement could settle.
  //
  // React restores a controlled text input after the form reset, so its DOM value
  // comes back on its own. It does not do the same for a `<select>`: the reset
  // drops the DOM back to the first option, React's `value` prop is unchanged
  // from the previous render, so nothing is written and the element keeps
  // reporting "". The row then submits an empty platform — the whole defect,
  // surviving the obvious fix. Measured, not assumed: the first save carried
  // WHATSAPP and the second carried "" with the URL still intact.
  //
  // This writes the DOM back from state after every commit, which is the commit
  // the reset rides in on.
  const selectRefs = useRef<(HTMLSelectElement | null)[]>([]);
  useEffect(() => {
    socialRows.forEach((row, index) => {
      const element = selectRefs.current[index];
      if (element !== null && element !== undefined && element.value !== row.platform) {
        element.value = row.platform;
      }
    });
  });

  // A successful save returns both slots to "unchanged", and reconciles the slug
  // field with what was actually stored.
  //
  // Not cosmetic. The browser empties a file input once the form has been
  // submitted, so a slot left on "replace" declares a replacement with no file
  // behind it. Validation then rejects the whole form, nothing is saved, and the
  // only sign is an error next to an image the owner did not touch — every save
  // after the first one fails, silently. Found by driving the editor on
  // `workerd`, not by any unit test.
  //
  // Compared against `savedAt` rather than `saved`, which stays true across
  // consecutive saves and so cannot mark a new one. Set during render, which is
  // React's supported way to adjust state in response to a change — an effect
  // would render the stale value first.
  //
  // The slug is adopted from the action's echoed value, which is the canonical
  // one. Watching `defaults` for a change instead cannot work: the case that
  // exposed this never changes the stored value — typing "Barberia Don Juan
  // Centro" over a stored `barberia-don-juan-centro` normalizes straight back
  // onto it. The field kept the raw text, so `slugChanged` stayed true and the
  // link-breakage warning sat on screen after a successful save, contradicting
  // the shareable link rendered directly above it (design D10).
  const [handledSaveAt, setHandledSaveAt] = useState<number | null>(null);
  if (state.savedAt !== null && state.savedAt !== handledSaveAt) {
    setHandledSaveAt(state.savedAt);
    setSlots((current) => ({
      photo: { ...current.photo, intent: 'unchanged', error: null },
      cover: { ...current.cover, intent: 'unchanged', error: null },
    }));
    setSlug(state.values.publicSlug);
    setSlugTouched(state.values.publicSlug.length > 0);
  }

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    errorRef.current?.focus();
  }, [state]);

  // Previews are object URLs, which the browser holds until they are revoked.
  // Unmounting without releasing them leaks the decoded image for the lifetime
  // of the document.
  useEffect(
    () => () => {
      for (const slot of Object.values(slots)) {
        if (slot.previewUrl !== null) pipeline.revokePreview(slot.previewUrl);
      }
    },
    // Intentionally on unmount only: the replace path revokes its own previous
    // URL, and re-running this on every slot change would revoke the URL that
    // is currently on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setBusinessName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(event: ChangeEvent<HTMLInputElement>): void {
    setSlugTouched(true);
    setSlug(event.target.value);
  }

  async function handleFileChange(
    slot: SlotName,
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    // Marked before the await, not after: the gap this closes starts the instant
    // the file lands in the input.
    setSlots((current) => ({ ...current, [slot]: { ...current[slot], preparing: true } }));

    try {
      const processed = await pipeline.process(file);
      // The input must carry the *processed* file: submitting what the owner
      // picked would send the original multi-megabyte photograph, which the
      // framework's unchanged body limit rejects (design D2).
      pipeline.attach(input, processed);

      setSlots((current) => {
        const previous = current[slot].previewUrl;
        if (previous !== null) pipeline.revokePreview(previous);
        return {
          ...current,
          [slot]: {
            intent: 'replace',
            previewUrl: pipeline.previewUrl(processed),
            error: null,
            preparing: false,
          },
        };
      });
    } catch {
      // The slot stays `unchanged`: a file we could not read must not be
      // mistaken for an instruction to replace anything.
      input.value = '';
      setSlots((current) => ({
        ...current,
        [slot]: {
          ...current[slot],
          intent: 'unchanged',
          preparing: false,
          error: COPY.businessProfile.imageUndecodable,
        },
      }));
    }
  }

  function handleRemoveImage(slot: SlotName): void {
    setSlots((current) => {
      const previous = current[slot].previewUrl;
      if (previous !== null) pipeline.revokePreview(previous);
      return {
        ...current,
        [slot]: { intent: 'remove', previewUrl: null, error: null, preparing: false },
      };
    });
  }

  const storedUrl: Record<SlotName, string | null> = {
    photo: defaults.photoUrl,
    cover: defaults.coverUrl,
  };

  const slugChanged = defaults.publicSlug.length > 0 && slug !== defaults.publicSlug;

  // Any slot still preparing closes the whole form: the intent that would carry
  // the replacement has not been raised yet, and a save sent now would silently
  // drop it while reporting success.
  const preparing = Object.values(slots).some((slot) => slot.preparing);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <Field
          id="businessName"
          label={COPY.businessProfile.businessNameLabel}
          error={state.fieldErrors.businessName}
        >
          <Input
            id="businessName"
            name="businessName"
            type="text"
            maxLength={120}
            autoComplete="organization"
            value={businessName}
            onChange={handleNameChange}
            required
            aria-invalid={state.fieldErrors.businessName ? true : undefined}
            aria-describedby={state.fieldErrors.businessName ? 'businessName-error' : undefined}
          />
        </Field>

        <Field id="bio" label={COPY.businessProfile.bioLabel} error={state.fieldErrors.bio} hint={COPY.businessProfile.bioHint}>
          <Textarea
            id="bio"
            name="bio"
            rows={4}
            maxLength={1000}
            defaultValue={state.values.bio}
            aria-invalid={state.fieldErrors.bio ? true : undefined}
            aria-describedby={state.fieldErrors.bio ? 'bio-error' : 'bio-hint'}
          />
        </Field>

        <Field
          id="publicSlug"
          label={COPY.businessProfile.slugLabel}
          error={state.fieldErrors.publicSlug}
          hint={COPY.businessProfile.slugHint}
        >
          <Input
            id="publicSlug"
            name="publicSlug"
            type="text"
            maxLength={60}
            autoComplete="off"
            value={slug}
            onChange={handleSlugChange}
            required
            aria-invalid={state.fieldErrors.publicSlug ? true : undefined}
            aria-describedby={state.fieldErrors.publicSlug ? 'publicSlug-error' : 'publicSlug-hint'}
          />
          {slugChanged ? (
            // Shown at the moment of change, which is the only moment it can be
            // acted on: there is no way to learn afterwards who holds the old
            // link.
            <p role="status" className="text-destructive text-xs">
              {COPY.businessProfile.slugChangeWarning}
            </p>
          ) : null}
        </Field>
      </section>

      <section className="flex flex-col gap-6">
        {(['photo', 'cover'] as const).map((slot) => (
          <ImageSlot
            key={slot}
            slot={slot}
            state={slots[slot]}
            storedUrl={storedUrl[slot]}
            fieldError={state.fieldErrors[slot]}
            onChange={(event) => void handleFileChange(slot, event)}
            onRemove={() => handleRemoveImage(slot)}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{COPY.businessProfile.socialHeading}</h2>
          <p className="text-muted-foreground text-xs">{COPY.businessProfile.socialIntro}</p>
        </div>

        {socialRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{COPY.businessProfile.socialEmpty}</p>
        ) : (
          socialRows.map((row, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`socialPlatform-${index}`}>
                    {COPY.businessProfile.socialPlatformLabel}
                  </Label>
                  <select
                    id={`socialPlatform-${index}`}
                    name="socialPlatform"
                    ref={(element) => {
                      selectRefs.current[index] = element;
                    }}
                    value={row.platform}
                    onChange={(event) => updateSocialRow(index, { platform: event.target.value })}
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  >
                    <option value="">—</option>
                    {SOCIAL_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`socialUrl-${index}`}>{COPY.businessProfile.socialUrlLabel}</Label>
                  <Input
                    id={`socialUrl-${index}`}
                    name="socialUrl"
                    type="url"
                    maxLength={500}
                    value={row.url}
                    onChange={(event) => updateSocialRow(index, { url: event.target.value })}
                    aria-invalid={state.fieldErrors.socialLinks?.[index] ? true : undefined}
                    aria-describedby={
                      state.fieldErrors.socialLinks?.[index] ? `socialUrl-${index}-error` : undefined
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSocialRows((rows) => rows.filter((_, i) => i !== index))}
                >
                  {COPY.businessProfile.socialRemove}
                </Button>
              </div>
              {state.fieldErrors.socialLinks?.[index] ? (
                <p
                  id={`socialUrl-${index}-error`}
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {state.fieldErrors.socialLinks[index]}
                </p>
              ) : null}
            </div>
          ))
        )}

        {state.fieldErrors.socialLinksForm ? (
          <p role="alert" className="text-destructive text-sm">
            {state.fieldErrors.socialLinksForm}
          </p>
        ) : null}

        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSocialRows((rows) => [...rows, { platform: '', url: '' }])}
            disabled={socialRows.length >= SOCIAL_PLATFORMS.length}
          >
            {COPY.businessProfile.socialAdd}
          </Button>
        </div>
      </section>

      {state.error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          aria-live="polite"
          className="text-destructive text-sm"
        >
          {state.error}
        </p>
      ) : null}

      {state.saved && !isPending ? (
        <p role="status" className="text-sm font-medium">
          {COPY.businessProfile.saved}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div>
          <Button type="submit" disabled={isPending || preparing}>
            {isPending ? COPY.businessProfile.saving : COPY.businessProfile.save}
          </Button>
        </div>
        {preparing ? (
          <p role="status" aria-live="polite" className="text-muted-foreground text-xs">
            {COPY.businessProfile.imageProcessing}
          </p>
        ) : null}
        {isPending ? (
          // A Server Action upload cannot report progress, so a save that takes
          // several seconds on a mobile connection is indistinguishable from a
          // frozen page without this.
          <p role="status" aria-live="polite" className="text-muted-foreground text-xs">
            {COPY.businessProfile.savingHint}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" aria-live="polite" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ImageSlot({
  slot,
  state,
  storedUrl,
  fieldError,
  onChange,
  onRemove,
}: {
  slot: SlotName;
  state: SlotState;
  storedUrl: string | null;
  fieldError?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  // What is on screen: a fresh preview, else the stored image unless it is being
  // removed, else nothing.
  const shown =
    state.previewUrl ?? (state.intent === 'remove' ? null : storedUrl);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={slot}>{SLOT_LABEL[slot]}</Label>

      {/* The intent travels as its own field. Inferring it from whether a file
          arrived would delete both images every time the owner edits only their
          bio, because a resubmitted form sends empty file inputs (design D4). */}
      <input type="hidden" name={`${slot}Intent`} value={state.intent} readOnly />

      <div
        data-slot-frame
        className={`bg-muted overflow-hidden rounded-md ${SLOT_ASPECT[slot]}`}
      >
        {shown !== null ? (
          // Rendered at the aspect ratio the public page uses. With no crop tool
          // this preview is the only place a mismatched image can be caught, so
          // it must not flatter the result.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={SLOT_LABEL[slot]} className="h-full w-full object-cover" />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
            {COPY.businessProfile.imageEmpty}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          id={slot}
          name={slot}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          className="max-w-xs"
          aria-describedby={`${slot}-hint`}
        />
        {shown !== null ? (
          <Button type="button" variant="outline" onClick={onRemove}>
            {COPY.businessProfile.imageRemove}
          </Button>
        ) : null}
      </div>

      <p id={`${slot}-hint`} className="text-muted-foreground text-xs">
        {COPY.businessProfile.imageHint}
      </p>
      <p className="text-muted-foreground text-xs">{COPY.businessProfile.imagePrivacyNote}</p>

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {fieldError ? (
        <p role="alert" className="text-destructive text-sm">
          {fieldError}
        </p>
      ) : null}
    </div>
  );
}
