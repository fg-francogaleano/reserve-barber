'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { COPY } from '@/lib/copy';
import { INITIAL_SERVICE_FORM_STATE, type ServiceFormState } from './formState';

export type ServiceFormAction = (
  state: ServiceFormState,
  formData: FormData
) => Promise<ServiceFormState>;

type ServiceFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: ServiceFormAction;
  /** Present when editing; absent when creating. */
  serviceId?: string;
  defaultName?: string;
  defaultPrice?: string;
  defaultDurationMinutes?: string;
  defaultDescription?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.services.form.submitting : COPY.services.form.submit}
    </Button>
  );
}

export function ServiceForm({
  action,
  serviceId,
  defaultName,
  defaultPrice,
  defaultDurationMinutes,
  defaultDescription,
}: ServiceFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_SERVICE_FORM_STATE,
    values: {
      name: defaultName ?? '',
      price: defaultPrice ?? '',
      durationMinutes: defaultDurationMinutes ?? '',
      description: defaultDescription ?? '',
    },
  });

  // Deterministic first-error order: name → price → durationMinutes →
  // description → general.
  const nameErrorRef = useRef<HTMLParagraphElement>(null);
  const priceErrorRef = useRef<HTMLParagraphElement>(null);
  const durationErrorRef = useRef<HTMLParagraphElement>(null);
  const descriptionErrorRef = useRef<HTMLParagraphElement>(null);
  const generalErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target =
      nameErrorRef.current ??
      priceErrorRef.current ??
      durationErrorRef.current ??
      descriptionErrorRef.current ??
      generalErrorRef.current;
    target?.focus();
  }, [state]);

  const nameError = state.fieldErrors.name;
  const priceError = state.fieldErrors.price;
  const durationError = state.fieldErrors.durationMinutes;
  const descriptionError = state.fieldErrors.description;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {serviceId ? <input type="hidden" name="id" value={serviceId} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{COPY.services.form.nameLabel}</Label>
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

      {/*
        Design D7: type="text" with inputMode="decimal", never type="number".
        A number-typed control submits an EMPTY STRING when the browser's parser
        rejects the value — which is what an es-AR keyboard's "4500,50" produces
        in Chrome. The server would then report a missing price for a price that
        was typed, and the echo-back below would have nothing to echo.
        No min/max/step/pattern either: those let the browser block the submit
        with a message in the browser's locale that lives nowhere in COPY.
      */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="price">{COPY.services.form.priceLabel}</Label>
        <Input
          id="price"
          name="price"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values.price}
          required
          aria-invalid={priceError ? true : undefined}
          aria-describedby={priceError ? 'price-error' : 'price-hint'}
        />
        <p id="price-hint" className="text-muted-foreground text-xs">
          {COPY.services.form.priceHint}
        </p>
        {priceError ? (
          <p
            ref={priceErrorRef}
            id="price-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {priceError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationMinutes">{COPY.services.form.durationLabel}</Label>
        <Input
          id="durationMinutes"
          name="durationMinutes"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values.durationMinutes}
          required
          aria-invalid={durationError ? true : undefined}
          aria-describedby={durationError ? 'durationMinutes-error' : 'durationMinutes-hint'}
        />
        <p id="durationMinutes-hint" className="text-muted-foreground text-xs">
          {COPY.services.form.durationHint}
        </p>
        {durationError ? (
          <p
            ref={durationErrorRef}
            id="durationMinutes-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {durationError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">{COPY.services.form.descriptionLabel}</Label>
        <Textarea
          id="description"
          name="description"
          maxLength={500}
          rows={4}
          defaultValue={state.values.description}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? 'description-error' : undefined}
        />
        {descriptionError ? (
          <p
            ref={descriptionErrorRef}
            id="description-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {descriptionError}
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
          href="/servicios"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          {COPY.services.form.cancel}
        </Link>
      </div>
    </form>
  );
}
