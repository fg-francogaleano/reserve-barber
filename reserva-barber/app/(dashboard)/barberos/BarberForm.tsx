'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { COPY } from '@/lib/copy';
import { INITIAL_BARBER_FORM_STATE, type BarberFormState } from './formState';

export type BarberFormAction = (
  state: BarberFormState,
  formData: FormData
) => Promise<BarberFormState>;

export type LocationOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type BarberFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: BarberFormAction;
  /** Present when editing; absent when creating. */
  barberId?: string;
  defaultDisplayName?: string;
  defaultLocationId?: string;
  defaultBio?: string;
  /**
   * Active locations ∪ the barber's current location (even if inactive).
   * Built server-side so the select option set is correct for design D5.
   */
  locations: LocationOption[];
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.barbers.form.submitting : COPY.barbers.form.submit}
    </Button>
  );
}

export function BarberForm({
  action,
  barberId,
  defaultDisplayName,
  defaultLocationId,
  defaultBio,
  locations,
}: BarberFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_BARBER_FORM_STATE,
    values: {
      displayName: defaultDisplayName ?? '',
      locationId: defaultLocationId ?? '',
      bio: defaultBio ?? '',
    },
  });

  // Deterministic first-error order: displayName → locationId → bio → general
  const nameErrorRef = useRef<HTMLParagraphElement>(null);
  const locationErrorRef = useRef<HTMLParagraphElement>(null);
  const bioErrorRef = useRef<HTMLParagraphElement>(null);
  const generalErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target =
      nameErrorRef.current ??
      locationErrorRef.current ??
      bioErrorRef.current ??
      generalErrorRef.current;
    target?.focus();
  }, [state]);

  const nameError = state.fieldErrors.displayName;
  const locationError = state.fieldErrors.locationId;
  const bioError = state.fieldErrors.bio;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {barberId ? <input type="hidden" name="id" value={barberId} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">{COPY.barbers.form.nameLabel}</Label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          maxLength={120}
          autoComplete="off"
          defaultValue={state.values.displayName}
          required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'displayName-error' : undefined}
        />
        {nameError ? (
          <p
            ref={nameErrorRef}
            id="displayName-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {nameError}
          </p>
        ) : null}
      </div>

      {/* Native <select> per design D6: form submits before hydration without
          client-side JS, which Radix/shadcn Select cannot guarantee. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="locationId">{COPY.barbers.form.locationLabel}</Label>
        <select
          id="locationId"
          name="locationId"
          defaultValue={state.values.locationId}
          required
          aria-invalid={locationError ? true : undefined}
          aria-describedby={locationError ? 'locationId-error' : undefined}
          className="border-input aria-invalid:border-destructive aria-invalid:ring-destructive/40 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors outline-none focus-visible:ring-ring focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="" disabled>
            {COPY.barbers.form.locationLabel}
          </option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.isActive
                ? loc.name
                : `${loc.name} ${COPY.barbers.form.inactiveLocationMarker}`}
            </option>
          ))}
        </select>
        {locationError ? (
          <p
            ref={locationErrorRef}
            id="locationId-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {locationError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bio">{COPY.barbers.form.bioLabel}</Label>
        <Textarea
          id="bio"
          name="bio"
          maxLength={500}
          rows={4}
          defaultValue={state.values.bio}
          aria-invalid={bioError ? true : undefined}
          aria-describedby={bioError ? 'bio-error' : undefined}
        />
        {bioError ? (
          <p
            ref={bioErrorRef}
            id="bio-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {bioError}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p
          ref={generalErrorRef}
          tabIndex={-1}
          role="alert"
          aria-live="polite"
          className="text-destructive text-sm"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Link
          href="/barberos"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          {COPY.barbers.form.cancel}
        </Link>
      </div>
    </form>
  );
}
