'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import { INITIAL_TIME_OFF_FORM_STATE, type TimeOffFormState } from './formState';

export type TimeOffFormAction = (
  state: TimeOffFormState,
  formData: FormData
) => Promise<TimeOffFormState>;

type TimeOffFormProps = {
  /** Injected rather than imported so the form can be rendered in a test. */
  action: TimeOffFormAction;
  barberId: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.timeOff.submitting : COPY.timeOff.submit}
    </Button>
  );
}

/**
 * `min-w-0` on the fieldset is load-bearing: browsers apply
 * `min-width: min-content` to `<fieldset>` in the UA stylesheet, so it refuses
 * to shrink below its widest row and the page scrolls sideways. Learned in M4,
 * applied here from the start.
 *
 * The whole group is disabled while pending, not just the button: React resets
 * uncontrolled inputs when the action resolves, so a value edited mid-flight
 * would vanish with no explanation.
 */
function Fields({ state }: { state: TimeOffFormState }) {
  const { pending } = useFormStatus();
  const error = (field: keyof TimeOffFormState['values']) => state.fieldErrors[field];

  return (
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">{COPY.timeOff.formHeading}</legend>

      <div className="flex min-w-0 flex-wrap gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="startDate">{COPY.timeOff.startDateLabel}</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={state.values.startDate}
            required
            aria-invalid={error('startDate') ? true : undefined}
            aria-describedby={error('startDate') ? 'startDate-error' : undefined}
          />
          {error('startDate') ? (
            <p
              id="startDate-error"
              data-field-error
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {error('startDate')}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="endDate">{COPY.timeOff.endDateLabel}</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={state.values.endDate}
            required
            aria-invalid={error('endDate') ? true : undefined}
            aria-describedby={error('endDate') ? 'endDate-error' : undefined}
          />
          {error('endDate') ? (
            <p
              id="endDate-error"
              data-field-error
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {error('endDate')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="startTime">{COPY.timeOff.startTimeLabel}</Label>
          <Input
            id="startTime"
            name="startTime"
            type="time"
            defaultValue={state.values.startTime}
            aria-invalid={error('startTime') ? true : undefined}
            aria-describedby={error('startTime') ? 'startTime-error' : undefined}
          />
          {error('startTime') ? (
            <p
              id="startTime-error"
              data-field-error
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {error('startTime')}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="endTime">{COPY.timeOff.endTimeLabel}</Label>
          <Input
            id="endTime"
            name="endTime"
            type="time"
            defaultValue={state.values.endTime}
            aria-invalid={error('endTime') ? true : undefined}
            aria-describedby={error('endTime') ? 'endTime-error' : undefined}
          />
          {error('endTime') ? (
            <p
              id="endTime-error"
              data-field-error
              tabIndex={-1}
              role="alert"
              className="text-destructive text-sm"
            >
              {error('endTime')}
            </p>
          ) : null}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">{COPY.timeOff.wholeDayHint}</p>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="reason">{COPY.timeOff.reasonLabel}</Label>
        <Input
          id="reason"
          name="reason"
          type="text"
          maxLength={255}
          autoComplete="off"
          defaultValue={state.values.reason}
          aria-invalid={error('reason') ? true : undefined}
          aria-describedby={error('reason') ? 'reason-error' : undefined}
        />
        {error('reason') ? (
          <p
            id="reason-error"
            data-field-error
            tabIndex={-1}
            role="alert"
            className="text-destructive text-sm"
          >
            {error('reason')}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

export function TimeOffForm({ action, barberId }: TimeOffFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_TIME_OFF_FORM_STATE);

  // The inputs are uncontrolled, so `defaultValue` is only read on mount.
  // Without remounting, a rejected save would re-render with the submitted
  // values in state while the DOM still shows the old ones — the echo-back
  // would be a lie. It also clears the form after a successful add.
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

  // Focus runs in its own effect, keyed on the remount. Doing both in one pass
  // silently loses the focus, because the remount destroys the element just
  // focused — the defect M5a hit and fixed.
  useEffect(() => {
    if (renderKey === 0) {
      return;
    }
    const firstFieldError = formRef.current?.querySelector<HTMLElement>('[data-field-error]');
    (firstFieldError ?? formRef.current?.querySelector<HTMLElement>('[data-form-error]'))?.focus();
  }, [renderKey]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-xl flex-col gap-6">
      <input type="hidden" name="barberId" value={barberId} />

      <Fields key={renderKey} state={state} />

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

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
