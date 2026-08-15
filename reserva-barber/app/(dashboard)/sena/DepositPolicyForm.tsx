'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import { formatAmount } from '@/server/domain/models/money';
import type { DepositEffect } from '@/server/application/services/PaymentConfigService';
import {
  INITIAL_DEPOSIT_FORM_STATE,
  describePolicy,
  type DepositFormState,
  type DepositFormValues,
} from './formState';

export type DepositFormAction = (
  state: DepositFormState,
  formData: FormData
) => Promise<DepositFormState>;

type DepositPolicyFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: DepositFormAction;
  removeAction: DepositFormAction;
  /** Read from the database by the page, never from submitted state. */
  defaults: DepositFormValues;
  /** Whether a policy is stored, which decides if removal is offered at all. */
  configured: boolean;
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

/** The deposit each service would charge, next to the price it applies to. */
function EffectTable({ effects }: { effects: DepositEffect[] }) {
  if (effects.length === 0) {
    return <p className="text-muted-foreground text-sm">{COPY.deposit.confirmNoServices}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="pb-1 font-medium">{COPY.deposit.confirmServiceColumn}</th>
            <th className="pb-1 text-right font-medium">{COPY.deposit.confirmPriceColumn}</th>
            <th className="pb-1 text-right font-medium">{COPY.deposit.confirmDepositColumn}</th>
          </tr>
        </thead>
        <tbody>
          {effects.map((effect) => (
            <tr key={effect.serviceId} className="border-t">
              <td className="py-1">{effect.serviceName}</td>
              <td className="py-1 text-right font-mono">${formatAmount(effect.price)}</td>
              <td className="py-1 text-right font-mono font-semibold">
                ${formatAmount(effect.deposit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DepositPolicyForm({
  action,
  removeAction,
  defaults,
  configured,
}: DepositPolicyFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_DEPOSIT_FORM_STATE,
    values: defaults,
  });
  const [removeState, removeFormAction] = useActionState(
    removeAction,
    INITIAL_DEPOSIT_FORM_STATE
  );

  /*
    Drives the field's affix and help text only. The validation rule that
    matters is re-derived on the server from the submitted type — a client-side
    hint is a convenience, never a constraint, and a submission that bypasses it
    is judged on the type it actually carried.
  */
  const [selectedType, setSelectedType] = useState(defaults.type || 'PERCENT');

  // Deterministic first-error order: type → value → general.
  const typeErrorRef = useRef<HTMLParagraphElement>(null);
  const valueErrorRef = useRef<HTMLParagraphElement>(null);
  const generalErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target = typeErrorRef.current ?? valueErrorRef.current ?? generalErrorRef.current;
    target?.focus();
  }, [state]);

  const pending = state.pendingConfirmation;
  const pendingRemoval = removeState.pendingRemoval;

  /*
    The confirmation is a re-render of this same form in a different state, not
    a modal and not a browser dialog (design D6). It therefore survives without
    JavaScript, and it cannot block the runtime the way window.confirm would.

    What it shows is what the policy CHARGES against real service prices, not
    the number the owner typed. A value off by a factor of ten passes every
    format check and is obvious here.
  */
  if (pending !== null) {
    return (
      <form action={formAction} className="flex max-w-2xl flex-col gap-4">
        {/*
          The answer travels ONLY on the button the owner pressed, as `intent`.
          A hidden field declaring the answer up front plus a button trying to
          override it does not work: FormData.get returns the FIRST value for a
          name, so the hidden one wins and "Volver a editar" commits the change
          — the guard asking for confirmation and then ignoring the answer.
        */}
        <input type="hidden" name="type" value={pending.policy.type} />
        <input type="hidden" name="value" value={pending.policy.value} />

        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-base font-semibold">{COPY.deposit.confirmHeading}</h2>
          <p className="text-muted-foreground text-sm">{COPY.deposit.confirmIntro}</p>

          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{COPY.deposit.confirmStoredLabel}</dt>
              <dd className="font-mono">{describePolicy(pending.stored.type, pending.stored.value)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{COPY.deposit.confirmNewLabel}</dt>
              <dd className="font-mono font-semibold">
                {describePolicy(pending.policy.type, pending.policy.value)}
              </dd>
            </div>
          </dl>

          {pending.policy.type === 'PERCENT' && pending.policy.value === '100' ? (
            <p className="text-sm font-medium">{COPY.deposit.fullPrepaymentNotice}</p>
          ) : null}

          <EffectTable effects={pending.effects} />

          <div className="flex items-center gap-3">
            <SubmitButton
              label={COPY.deposit.confirmSubmit}
              pendingLabel={COPY.deposit.submitting}
              name="intent"
              value="deposit-confirm"
            />
            {/*
              A submit carrying `intent=deposit-edit` returns the owner to the
              editor with the values still in hand and writes nothing. Formless
              navigation would lose them, and a click handler would make the
              path depend on JavaScript.
            */}
            <button
              type="submit"
              name="intent"
              value="deposit-edit"
              formNoValidate
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            >
              {COPY.deposit.confirmCancel}
            </button>
          </div>
        </div>
      </form>
    );
  }

  if (pendingRemoval !== null) {
    return (
      <form action={removeFormAction} className="flex max-w-lg flex-col gap-4">
        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-base font-semibold">{COPY.deposit.confirmRemoveHeading}</h2>
          <p className="text-muted-foreground text-sm">{COPY.deposit.confirmRemoveIntro}</p>
          <p className="font-mono text-sm">
            {describePolicy(pendingRemoval.type, pendingRemoval.value)}
          </p>

          <div className="flex items-center gap-3">
            <SubmitButton
              label={COPY.deposit.confirmRemoveSubmit}
              pendingLabel={COPY.deposit.submitting}
              name="intent"
              value="deposit-confirm"
            />
            <button
              type="submit"
              name="intent"
              value="deposit-edit"
              formNoValidate
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            >
              {COPY.deposit.confirmCancel}
            </button>
          </div>
        </div>
      </form>
    );
  }

  const typeError = state.fieldErrors.type;
  const valueError = state.fieldErrors.value;
  const generalError = state.error ?? removeState.error;
  const isPercent = selectedType === 'PERCENT';

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{COPY.deposit.typeLegend}</legend>

          {/*
            A real radio group, not a select: two mutually exclusive options
            that change what the field below means deserve to be visible at
            once. `aria-describedby` wires the error to the group rather than to
            one input, because the mistake belongs to the choice.
          */}
          {(['PERCENT', 'FIXED'] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="type"
                value={option}
                checked={selectedType === option}
                onChange={() => setSelectedType(option)}
                aria-describedby={typeError ? 'deposit-type-error' : undefined}
                className="size-4"
              />
              {option === 'PERCENT' ? COPY.deposit.typePercent : COPY.deposit.typeFixed}
            </label>
          ))}

          {typeError ? (
            <p
              id="deposit-type-error"
              ref={typeErrorRef}
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {typeError}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deposit-value">
            {isPercent ? COPY.deposit.percentLabel : COPY.deposit.fixedLabel}
          </Label>
          {/*
            type="text" with inputMode="numeric", never type="number": a
            number-typed control submits an empty string when the browser's
            parser rejects the input, making "missing" indistinguishable from
            "malformed" and leaving nothing to echo back. No min/max/step
            either — those let the browser block the submit with a message in
            the browser's locale that lives nowhere in COPY, and the server rule
            would never run.
          */}
          <Input
            id="deposit-value"
            name="value"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={state.values.value}
            aria-invalid={valueError ? true : undefined}
            aria-describedby={valueError ? 'deposit-value-error' : 'deposit-value-help'}
          />
          <p id="deposit-value-help" className="text-muted-foreground text-xs">
            {isPercent ? COPY.deposit.percentHelp : COPY.deposit.fixedHelp}
          </p>
          {valueError ? (
            <p
              id="deposit-value-error"
              ref={valueErrorRef}
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {valueError}
            </p>
          ) : null}
        </div>

        <div>
          <SubmitButton label={COPY.deposit.submit} pendingLabel={COPY.deposit.submitting} />
        </div>

        {/*
          Both notices are gated on `configured`, which the SERVER re-renders
          after either action revalidates the page.

          Saving and removing are two separate action states, and neither
          resets the other: after a removal the save's "guardada" would still
          be mounted, leaving the page saying both "todavía no configuraste la
          seña" and "seña guardada" at once. Tying each notice to what is
          actually stored is right in either order, and on this screen a
          contradiction is worse than a missing confirmation.
        */}
        {state.saved && configured ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-sm font-medium">{COPY.deposit.saved}</p>
            {state.values.type === 'PERCENT' && state.values.value === '100' ? (
              <p className="text-sm">{COPY.deposit.fullPrepaymentNotice}</p>
            ) : null}
          </div>
        ) : null}

        {removeState.removed && !configured ? (
          <p className="text-sm font-medium" role="status">
            {COPY.deposit.removed}
          </p>
        ) : null}

        {/*
          Shown ALONGSIDE the success, never instead of it: the save did happen,
          and the owner needs both facts.
        */}
        {state.noPaymentMethod || removeState.noPaymentMethod ? (
          <p className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-sm">
            {COPY.deposit.noMethodWarning}
          </p>
        ) : null}

        {state.servicesBelowDeposit.length > 0 && configured ? (
          <div className="rounded-lg border p-3 text-sm">
            <p>{COPY.deposit.exceedsPricesWarning}</p>
            <ul className="mt-1 list-inside list-disc">
              {state.servicesBelowDeposit.map((effect) => (
                <li key={effect.serviceId}>
                  {effect.serviceName} — ${formatAmount(effect.price)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.servicesBelowMinimum.length > 0 && configured ? (
          <div className="rounded-lg border p-3 text-sm">
            <p>{COPY.deposit.belowMinimumWarning}</p>
            <ul className="mt-1 list-inside list-disc">
              {state.servicesBelowMinimum.map((effect) => (
                <li key={effect.serviceId}>
                  {effect.serviceName} — ${formatAmount(effect.deposit)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {generalError ? (
          <p
            ref={generalErrorRef}
            tabIndex={-1}
            role="alert"
            className="text-destructive text-sm"
          >
            {generalError}
          </p>
        ) : null}
      </form>

      {/*
        Removal is its own form and its own explicit action. It is never the
        consequence of submitting the editor with an empty field — this is a
        single-field form, and one keystroke would otherwise leave the business
        unable to take bookings while looking like an ordinary save (design D8).
      */}
      {configured ? (
        <form action={removeFormAction}>
          <button
            type="submit"
            formNoValidate
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            {COPY.deposit.remove}
          </button>
        </form>
      ) : null}
    </div>
  );
}

