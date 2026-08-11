'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { WEEKDAY_DISPLAY_ORDER } from '@/server/domain/models/weekday';
import { INITIAL_SCHEDULE_FORM_STATE, type ScheduleFormState, type WeekValues } from './formState';

export type WeeklyScheduleFormAction = (
  state: ScheduleFormState,
  formData: FormData
) => Promise<ScheduleFormState>;

type WeeklyScheduleFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: WeeklyScheduleFormAction;
  barberId: string;
  defaultValues: WeekValues;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.workingHours.submitting : COPY.workingHours.submit}
    </Button>
  );
}

/**
 * The whole group is disabled while a save is in flight, not just the submit
 * button. React resets uncontrolled inputs when the action resolves, so a time
 * edited mid-flight would be discarded with no explanation — and with fourteen
 * fields, that loss is far more expensive than a single checkbox.
 *
 * `min-w-0` on the fieldset is load-bearing: browsers apply
 * `min-width: min-content` to `<fieldset>` in the UA stylesheet, so it refuses
 * to shrink below its widest row and the page scrolls sideways. Learned the
 * hard way in M4, applied here from the start.
 */
function DayRows({
  values,
  dayErrors,
}: {
  values: WeekValues;
  dayErrors: Record<number, string>;
}) {
  const { pending } = useFormStatus();

  return (
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">{COPY.workingHours.legend}</legend>
      {WEEKDAY_DISPLAY_ORDER.map((day) => {
        const key = String(day);
        const error = dayErrors[day];
        return (
          <div key={day} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium">
                {COPY.workingHours.dayNames[day]}
              </span>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{COPY.workingHours.startLabel}</span>
                <input
                  type="time"
                  name={`start-${key}`}
                  defaultValue={values[key]?.start ?? ''}
                  aria-label={`${COPY.workingHours.dayNames[day]} — ${COPY.workingHours.startLabel}`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `day-${key}-error` : undefined}
                  className="border-input bg-background rounded-md border px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{COPY.workingHours.endLabel}</span>
                <input
                  type="time"
                  name={`end-${key}`}
                  defaultValue={values[key]?.end ?? ''}
                  aria-label={`${COPY.workingHours.dayNames[day]} — ${COPY.workingHours.endLabel}`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `day-${key}-error` : undefined}
                  className="border-input bg-background rounded-md border px-2 py-1"
                />
              </label>
            </div>
            {error ? (
              <p
                id={`day-${key}-error`}
                data-day-error={key}
                tabIndex={-1}
                role="alert"
                aria-live="polite"
                className="text-destructive text-sm"
              >
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export function WeeklyScheduleForm({
  action,
  barberId,
  defaultValues,
}: WeeklyScheduleFormProps) {
  const [state, formAction] = useActionState(action, {
    ...INITIAL_SCHEDULE_FORM_STATE,
    values: defaultValues,
  });

  // The time fields are uncontrolled, so `defaultValue` is only read on mount.
  // Without remounting, a rejected save would re-render with the submitted week
  // in state while the DOM still shows the stored one — the echo-back would be
  // a lie.
  const [renderKey, setRenderKey] = useState(0);
  const isFirstRender = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setRenderKey((key) => key + 1);
  }, [state]);

  // Focus runs in its own effect, keyed on the remount rather than on the state.
  // Doing both in one pass silently loses the focus: bumping `renderKey`
  // destroys and recreates the fieldset, taking the just-focused day error with
  // it. The grid is taller than a phone viewport, so an error the owner cannot
  // see is an error that did not happen as far as they are concerned.
  useEffect(() => {
    if (renderKey === 0) {
      return;
    }
    const firstDayError = formRef.current?.querySelector<HTMLElement>('[data-day-error]');
    (firstDayError ?? formRef.current?.querySelector<HTMLElement>('[data-form-error]'))?.focus();
  }, [renderKey]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-xl flex-col gap-6">
      <input type="hidden" name="barberId" value={barberId} />

      <DayRows key={renderKey} values={state.values} dayErrors={state.dayErrors} />

      {state.error ? (
        <p
          data-form-error
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
          {COPY.workingHours.cancel}
        </Link>
      </div>
    </form>
  );
}
