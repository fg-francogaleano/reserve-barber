'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import {
  INITIAL_BARBER_SERVICES_FORM_STATE,
  type BarberServicesFormState,
} from './formState';

export type AssignableService = {
  id: string;
  name: string;
  isActive: boolean;
};

export type BarberServicesFormAction = (
  state: BarberServicesFormState,
  formData: FormData
) => Promise<BarberServicesFormState>;

type BarberServicesFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: BarberServicesFormAction;
  barberId: string;
  services: AssignableService[];
  assignedIds: string[];
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.barberServices.submitting : COPY.barberServices.submit}
    </Button>
  );
}

/**
 * The whole group is disabled while a save is in flight, not just the submit
 * button. React 19 resets uncontrolled inputs when the action resolves, so a
 * checkbox toggled mid-flight would be silently discarded — the user would see
 * their own change vanish with no message explaining it.
 *
 * `useFormStatus` only reports the pending state from inside the form, which is
 * why this is a child component rather than a branch in the parent.
 */
function ServiceFieldset({
  services,
  checkedIds,
  invalidServiceId,
}: {
  services: AssignableService[];
  checkedIds: Set<string>;
  invalidServiceId: string | null;
}) {
  const { pending } = useFormStatus();

  return (
    // min-w-0 is load-bearing and easy to miss here: browsers apply
    // `min-width: min-content` to <fieldset> in the UA stylesheet, so it refuses
    // to shrink below its widest label no matter what its children declare.
    // Measured at a 360px container with a 120-character service name: 882px of
    // scroll width before this class, 360px after. Same failure family as T18,
    // one level higher than the row and label that already carry it.
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">{COPY.barberServices.legend}</legend>
      {services.map((service) => {
        const isOffender = invalidServiceId === service.id;
        return (
          // min-w-0 on the row and the label: a flex item refuses to shrink
          // below its content's intrinsic width, so `break-words` alone never
          // acts and a 120-character name overflows (same defect as T18).
          <div key={service.id} className="flex min-w-0 items-start gap-2">
            <input
              type="checkbox"
              id={`service-${service.id}`}
              name="serviceIds"
              value={service.id}
              defaultChecked={checkedIds.has(service.id)}
              aria-invalid={isOffender ? true : undefined}
              aria-describedby={isOffender ? 'selection-error' : undefined}
              className="mt-1 size-4 shrink-0"
            />
            <label
              htmlFor={`service-${service.id}`}
              className={`min-w-0 text-sm break-words ${isOffender ? 'text-destructive' : ''}`}
            >
              {service.name}
              {!service.isActive ? (
                <span className="text-muted-foreground ml-1 text-xs">
                  {COPY.barberServices.inactiveMarker}
                </span>
              ) : null}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

export function BarberServicesForm({
  action,
  barberId,
  services,
  assignedIds,
}: BarberServicesFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_BARBER_SERVICES_FORM_STATE,
    values: { serviceIds: assignedIds },
  });

  // The checkboxes are uncontrolled, so `defaultChecked` is only read on mount.
  // Without remounting, a rejected save would re-render with the submitted
  // selection in state while the DOM still shows the stored one — the echo-back
  // would be a lie. Bumping a key on each returned state forces the group to
  // remount so the echoed selection actually wins.
  const [renderKey, setRenderKey] = useState(0);
  const isFirstRender = useRef(true);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setRenderKey((key) => key + 1);
    // With up to fifty controls, an error rendered above the fold while the
    // submit button sits below it is an error the owner never sees.
    errorRef.current?.focus();
  }, [state]);

  const checkedIds = new Set(state.values.serviceIds);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-6">
      <input type="hidden" name="barberId" value={barberId} />

      {/*
        The rendered baseline (design D3). Removals are computed against THIS
        list, not against stored state, so an assignment created after this page
        loaded is not deleted by a form that never displayed it. It doubles as
        the proof that a submission occurred: an all-unchecked form omits
        `serviceIds` entirely, so without this an empty selection and a missing
        field would be the same payload.
      */}
      {services.map((service) => (
        <input
          key={service.id}
          type="hidden"
          name="renderedServiceIds"
          value={service.id}
        />
      ))}

      <ServiceFieldset
        key={renderKey}
        services={services}
        checkedIds={checkedIds}
        invalidServiceId={state.invalidServiceId}
      />

      {state.error ? (
        <p
          ref={errorRef}
          id="selection-error"
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
          {COPY.barberServices.cancel}
        </Link>
      </div>
    </form>
  );
}
