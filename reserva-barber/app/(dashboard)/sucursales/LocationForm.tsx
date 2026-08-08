'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import { INITIAL_LOCATION_FORM_STATE, type LocationFormState } from './formState';

export type LocationFormAction = (
  state: LocationFormState,
  formData: FormData
) => Promise<LocationFormState>;

type LocationFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: LocationFormAction;
  /** Present when editing; absent when creating. */
  locationId?: string;
  defaultName?: string;
  defaultAddress?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.locations.form.submitting : COPY.locations.form.submit}
    </Button>
  );
}

export function LocationForm({
  action,
  locationId,
  defaultName,
  defaultAddress,
}: LocationFormProps) {
  // The initial state seeds the inputs, and every action result carries the
  // submitted values back. React 19 resets an uncontrolled form once its action
  // resolves, so rendering `defaultValue` from state is what makes the reset
  // land on what the owner typed instead of on blanks.
  const [state, formAction] = useActionState(action, {
    ...INITIAL_LOCATION_FORM_STATE,
    values: { name: defaultName ?? '', address: defaultAddress ?? '' },
  });
  const errorRef = useRef<HTMLParagraphElement>(null);
  const nameErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Move focus to the first problem so a keyboard or screen-reader user is
    // told what happened instead of being left at the submit button.
    const target = nameErrorRef.current ?? errorRef.current;
    target?.focus();
  }, [state]);

  const nameError = state.fieldErrors.name;
  const addressError = state.fieldErrors.address;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {locationId ? <input type="hidden" name="id" value={locationId} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{COPY.locations.form.nameLabel}</Label>
        <Input
          id="name"
          name="name"
          type="text"
          maxLength={120}
          autoComplete="off"
          defaultValue={state.values.name}
          required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        {nameError ? (
          <p
            ref={nameErrorRef}
            id="name-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">{COPY.locations.form.addressLabel}</Label>
        <Input
          id="address"
          name="address"
          type="text"
          maxLength={255}
          autoComplete="off"
          defaultValue={state.values.address}
          aria-invalid={addressError ? true : undefined}
          aria-describedby={addressError ? 'address-error' : undefined}
        />
        {addressError ? (
          <p id="address-error" role="alert" aria-live="polite" className="text-destructive text-sm">
            {addressError}
          </p>
        ) : null}
      </div>

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

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Link
          href="/sucursales"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          {COPY.locations.form.cancel}
        </Link>
      </div>
    </form>
  );
}
