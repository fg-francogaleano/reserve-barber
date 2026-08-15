'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import { formatCbu } from '@/server/domain/models/cbu';
import {
  INITIAL_TRANSFER_FORM_STATE,
  type TransferFormState,
  type TransferFormValues,
} from './formState';

export type TransferFormAction = (
  state: TransferFormState,
  formData: FormData
) => Promise<TransferFormState>;

type TransferDetailsFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: TransferFormAction;
  /** Read from the database by the page, never from submitted state. */
  defaults: TransferFormValues;
};

function SubmitButton({
  label,
  pendingLabel,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function TransferDetailsForm({ action, defaults }: TransferDetailsFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_TRANSFER_FORM_STATE,
    values: defaults,
  });

  // Deterministic first-error order: cbuCvu → alias → holderName → form-level
  // → general.
  const cbuErrorRef = useRef<HTMLParagraphElement>(null);
  const aliasErrorRef = useRef<HTMLParagraphElement>(null);
  const holderErrorRef = useRef<HTMLParagraphElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const generalErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target =
      cbuErrorRef.current ??
      aliasErrorRef.current ??
      holderErrorRef.current ??
      formErrorRef.current ??
      generalErrorRef.current;
    target?.focus();
  }, [state]);

  const pending = state.pendingConfirmation;

  /*
    The confirmation is a re-render of this same form in a different state, not
    a modal and not a browser dialog (design D14). It therefore survives without
    JavaScript, and it cannot block the runtime the way window.confirm would.

    What it shows is the NORMALIZED value the server would store, not the text
    the owner typed — confirming the latter would confirm the wrong thing.
  */
  if (pending !== null) {
    const clearing = pending.cbuCvu === null && pending.alias === null;

    return (
      <form action={formAction} className="flex max-w-lg flex-col gap-4">
        {/*
          The answer travels ONLY on the button the owner pressed, as `intent`.
          A hidden field declaring the answer up front plus a button trying to
          override it does not work: FormData.get returns the FIRST value for a
          name, so the hidden one wins and "Volver a editar" commits the change
          — the guard asking for confirmation and then ignoring the answer.
        */}
        <input type="hidden" name="cbuCvu" value={pending.cbuCvu ?? ''} />
        <input type="hidden" name="alias" value={pending.alias ?? ''} />
        <input type="hidden" name="holderName" value={pending.holderName ?? ''} />

        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-base font-semibold">{COPY.transfer.confirmHeading}</h2>
          <p className="text-muted-foreground text-sm">
            {clearing ? COPY.transfer.confirmClearIntro : COPY.transfer.confirmIntro}
          </p>

          {clearing ? null : (
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmCbuLabel}</dt>
                <dd className="font-mono">
                  {pending.cbuCvu ? formatCbu(pending.cbuCvu) : COPY.transfer.confirmNone}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmAliasLabel}</dt>
                <dd className="font-mono">{pending.alias ?? COPY.transfer.confirmNone}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmHolderLabel}</dt>
                <dd>{pending.holderName ?? COPY.transfer.confirmNone}</dd>
              </div>
            </dl>
          )}

          <div className="flex items-center gap-3">
            <SubmitButton
              label={COPY.transfer.confirmSubmit}
              pendingLabel={COPY.transfer.submitting}
              name="intent"
              value="transfer-confirm"
            />
            {/*
              A submit carrying `intent=edit` returns the owner to the editor
              with the values still in hand and writes nothing. Formless
              navigation would lose them, and a click handler would make the
              path depend on JavaScript.
            */}
            <button
              type="submit"
              name="intent"
              value="transfer-edit"
              formNoValidate
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            >
              {COPY.transfer.confirmCancel}
            </button>
          </div>
        </div>
      </form>
    );
  }

  const cbuError = state.fieldErrors.cbuCvu;
  const aliasError = state.fieldErrors.alias;
  const holderError = state.fieldErrors.holderName;
  const formError = state.fieldErrors.form;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {/*
        type="text" with inputMode="numeric", never type="number": a
        number-typed control submits an empty string when the browser's parser
        rejects the input, making "missing" indistinguishable from "malformed"
        and leaving nothing to echo back. No min/max/step/pattern either —
        those let the browser block the submit with a message in the browser's
        locale that lives nowhere in COPY, and the server rule would never run.
      */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cbuCvu">{COPY.transfer.cbuLabel}</Label>
        <Input
          id="cbuCvu"
          name="cbuCvu"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values.cbuCvu}
          aria-invalid={cbuError ? true : undefined}
          aria-describedby={cbuError ? 'cbuCvu-error' : 'cbuCvu-hint'}
        />
        <p id="cbuCvu-hint" className="text-muted-foreground text-xs">
          {COPY.transfer.cbuHelp}
        </p>
        {cbuError ? (
          <p
            ref={cbuErrorRef}
            id="cbuCvu-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {cbuError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="alias">{COPY.transfer.aliasLabel}</Label>
        <Input
          id="alias"
          name="alias"
          type="text"
          autoComplete="off"
          defaultValue={state.values.alias}
          aria-invalid={aliasError ? true : undefined}
          aria-describedby={aliasError ? 'alias-error' : 'alias-hint'}
        />
        <p id="alias-hint" className="text-muted-foreground text-xs">
          {COPY.transfer.aliasHelp}
        </p>
        {aliasError ? (
          <p
            ref={aliasErrorRef}
            id="alias-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {aliasError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="holderName">{COPY.transfer.holderLabel}</Label>
        <Input
          id="holderName"
          name="holderName"
          type="text"
          maxLength={120}
          autoComplete="off"
          defaultValue={state.values.holderName}
          aria-invalid={holderError ? true : undefined}
          aria-describedby={holderError ? 'holderName-error' : 'holderName-hint'}
        />
        <p id="holderName-hint" className="text-muted-foreground text-xs">
          {COPY.transfer.holderHelp}
        </p>
        {holderError ? (
          <p
            ref={holderErrorRef}
            id="holderName-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {holderError}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          ref={formErrorRef}
          tabIndex={-1}
          role="alert"
          aria-live="polite"
          className="text-destructive text-sm"
        >
          {formError}
        </p>
      ) : null}

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

      {state.saved ? (
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {COPY.transfer.saved}
        </p>
      ) : null}

      {/*
        Shown ALONGSIDE the success, never instead of it: the save did happen,
        and replacing the confirmation with a warning would read as a failure.
      */}
      {state.noPaymentMethod ? (
        <p
          role="alert"
          aria-live="polite"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
        >
          {COPY.transfer.noMethodWarning}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={COPY.transfer.submit} pendingLabel={COPY.transfer.submitting} />
      </div>
    </form>
  );
}
