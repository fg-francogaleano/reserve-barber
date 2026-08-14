'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import {
  INITIAL_MERCADO_PAGO_STATE,
  type MercadoPagoFormState,
  type MercadoPagoFormValues,
} from './formState';

export type MercadoPagoFormAction = (
  state: MercadoPagoFormState,
  formData: FormData
) => Promise<MercadoPagoFormState>;

type Props = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: MercadoPagoFormAction;
  /** Read from the database by the page, never from submitted state. */
  defaults: MercadoPagoFormValues;
  /** Drives whether the removal control is offered at all. */
  configured: boolean;
};

/**
 * The pending label depends on what was actually submitted.
 *
 * A save may wait seconds on Mercado Pago, and saying so is what stops the
 * owner concluding the form is stuck and clicking again (design D5). A removal
 * contacts nobody — giving it the same label would have the button assert a
 * network call that never happens.
 *
 * `useFormStatus` exposes the submitted `FormData`, so the intent that was
 * actually sent decides, rather than a prop guessing ahead of the submission.
 */
function pendingLabel(data: FormData | null): string {
  const intent = data?.get('intent');
  return intent === 'remove' || intent === 'confirm-remove'
    ? COPY.mercadoPago.removing
    : COPY.mercadoPago.verifying;
}

function SubmitButton({ label, name, value }: { label: string; name?: string; value?: string }) {
  const { pending, data } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} disabled={pending}>
      {pending ? pendingLabel(data) : label}
    </Button>
  );
}

/**
 * A plain submit that still carries its own `intent` — used for the secondary
 * controls ("Borrar credenciales", "Volver a editar").
 *
 * It exists as a component rather than a bare `<button>` so it can read
 * `useFormStatus`, which is only available to a **child** of the form. Without
 * that, these controls stayed live during an in-flight submission and a second
 * click could queue a removal behind a save.
 *
 * Still a submit button with `name`/`value`, never a click handler: that is
 * what keeps the flow working with JavaScript disabled.
 */
function SecondarySubmit({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={value}
      formNoValidate
      disabled={pending}
      className={`${className} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}

export function MercadoPagoCredentialsForm({ action, defaults, configured }: Props) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_MERCADO_PAGO_STATE,
    values: defaults,
  });

  // Deterministic first-error order: accessToken → publicKey → form → general.
  const tokenErrorRef = useRef<HTMLParagraphElement>(null);
  const keyErrorRef = useRef<HTMLParagraphElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const generalErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target =
      tokenErrorRef.current ??
      keyErrorRef.current ??
      formErrorRef.current ??
      generalErrorRef.current;
    target?.focus();
  }, [state]);

  const pending = state.pendingConfirmation;

  /*
    The confirmation is a re-render of this same form in a different state, not
    a modal and not a browser dialog (design D6). It therefore survives without
    JavaScript and cannot block the runtime the way window.confirm would.

    Nothing here is secret: the account identity, the environment and four
    characters. The token itself never reached the browser — it is waiting in an
    encrypted httpOnly cookie (design D7), which is why there are no hidden
    credential inputs the way PC1's confirmation has.
  */
  if (pending !== null) {
    const removing = state.pendingIntent === 'remove';

    return (
      <form action={formAction} className="flex max-w-lg flex-col gap-4">
        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-base font-semibold">
            {removing ? COPY.mercadoPago.confirmRemoveHeading : COPY.mercadoPago.confirmHeading}
          </h2>
          <p className="text-muted-foreground text-sm">
            {removing ? COPY.mercadoPago.confirmRemoveIntro : COPY.mercadoPago.confirmIntro}
          </p>

          {/*
            Design D6a lived here — a sentence separating a rotation within one
            account from a redirection of every future deposit, derived offline
            from the token. It was withdrawn: the number it compared is not the
            Mercado Pago account (T43). What identifies the account now is the
            name below, and only when Mercado Pago supplied it.
          */}
          {!pending.verified && !removing ? (
            <p className="text-muted-foreground text-sm">{COPY.mercadoPago.confirmUnverified}</p>
          ) : null}

          {removing ? null : (
            <dl className="flex flex-col gap-2 text-sm">
              {/*
                Shown only when Mercado Pago named the account. There is no
                offline fallback any more, and inventing one is what produced
                the withdrawn D6a — an identifier that identified nothing.
              */}
              {pending.displayName === null ? null : (
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{COPY.mercadoPago.accountLabel}</dt>
                  <dd className="font-mono">{pending.displayName}</dd>
                </div>
              )}
              {/* Only when the credential says so outright — never inferred. */}
              {pending.environment === 'test' ? (
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">
                    {COPY.mercadoPago.environmentLabel}
                  </dt>
                  <dd>{COPY.mercadoPago.environmentTest}</dd>
                </div>
              ) : null}
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.mercadoPago.confirmNewLabel}</dt>
                <dd className="font-mono">···{pending.lastFour ?? COPY.mercadoPago.none}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">
                  {COPY.mercadoPago.confirmStoredLabel}
                </dt>
                <dd className="font-mono">···{pending.storedLastFour ?? COPY.mercadoPago.none}</dd>
              </div>
            </dl>
          )}

          <div className="flex items-center gap-3">
            <SubmitButton
              label={
                removing ? COPY.mercadoPago.confirmRemoveSubmit : COPY.mercadoPago.confirmSubmit
              }
              name="intent"
              value={removing ? 'confirm-remove' : 'confirm'}
            />
            {/*
              A submit carrying `intent=edit` returns the owner to the editor and
              writes nothing. Formless navigation would lose the public key, and
              a click handler would make the path depend on JavaScript.
            */}
            <SecondarySubmit
              label={COPY.mercadoPago.confirmCancel}
              value="edit"
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            />
          </div>
        </div>
      </form>
    );
  }

  const tokenError = state.fieldErrors.accessToken;
  const keyError = state.fieldErrors.publicKey;
  const formError = state.fieldErrors.form;

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {/*
        Always rendered empty, never pre-filled with a mask: a masked default
        that submits back the mask stores the mask. `type="password"` is
        deliberately NOT used — it invites the browser's password manager to
        save it and, worse, to autofill the owner's login password here on a
        later visit.
      */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accessToken">{COPY.mercadoPago.accessTokenLabel}</Label>
        <Input
          id="accessToken"
          name="accessToken"
          type="text"
          autoComplete="off"
          spellCheck={false}
          defaultValue=""
          aria-invalid={tokenError ? true : undefined}
          aria-describedby={tokenError ? 'accessToken-error' : 'accessToken-hint'}
        />
        <p id="accessToken-hint" className="text-muted-foreground text-xs">
          {COPY.mercadoPago.accessTokenHelp}
        </p>
        {tokenError ? (
          <p
            ref={tokenErrorRef}
            id="accessToken-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {tokenError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="publicKey">{COPY.mercadoPago.publicKeyLabel}</Label>
        <Input
          id="publicKey"
          name="publicKey"
          type="text"
          autoComplete="off"
          spellCheck={false}
          defaultValue={state.values.publicKey}
          aria-invalid={keyError ? true : undefined}
          aria-describedby={keyError ? 'publicKey-error' : 'publicKey-hint'}
        />
        <p id="publicKey-hint" className="text-muted-foreground text-xs">
          {COPY.mercadoPago.publicKeyHelp}
        </p>
        {keyError ? (
          <p
            ref={keyErrorRef}
            id="publicKey-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="text-destructive text-sm"
          >
            {keyError}
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

      {/*
        The token field empties on every rejection by design. Without saying so,
        the owner reads it as the form having lost their work.
      */}
      {tokenError || keyError || formError || state.error ? (
        <p className="text-muted-foreground text-xs">{COPY.mercadoPago.tokenClearedNotice}</p>
      ) : null}

      {state.saved ? (
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {COPY.mercadoPago.saved}
        </p>
      ) : null}

      {state.removed ? (
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {COPY.mercadoPago.removed}
        </p>
      ) : null}

      {/* Shown ALONGSIDE the success: the save did happen (design D5). */}
      {state.unverified ? (
        <p
          role="alert"
          aria-live="polite"
          className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-sm"
        >
          {COPY.mercadoPago.savedUnverified}
        </p>
      ) : null}

      {state.noPaymentMethod ? (
        <p
          role="alert"
          aria-live="polite"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
        >
          {COPY.mercadoPago.noMethodWarning}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={COPY.mercadoPago.submit} />
        {/*
          Removal is its own explicit intent, never the absence of a value
          (design D3) — an empty token field means "leave it alone".
        */}
        {configured ? (
          <SecondarySubmit
            label={COPY.mercadoPago.remove}
            value="remove"
            className="text-destructive text-sm underline-offset-4 hover:underline"
          />
        ) : null}
      </div>
    </form>
  );
}
