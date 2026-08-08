'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COPY } from '@/lib/copy';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? COPY.auth.submitting : COPY.auth.submit}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Remounting the password input on every new error clears it while the
  // (uncontrolled) email input keeps its value — design D11. Adjusting state
  // during render (not in an effect) on a derived-value change is the
  // documented React pattern for this — see "Adjusting state when a prop
  // changes" in the Effects docs.
  const [prevError, setPrevError] = useState(state.error);
  const [passwordResetKey, setPasswordResetKey] = useState(0);
  if (state.error !== prevError) {
    setPrevError(state.error);
    if (state.error) {
      setPasswordResetKey((key) => key + 1);
    }
  }

  useEffect(() => {
    if (state.error) {
      errorRef.current?.focus();
    }
  }, [state.error]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{COPY.auth.emailLabel}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{COPY.auth.passwordLabel}</Label>
        <Input
          key={passwordResetKey}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      {state.error ? (
        <p ref={errorRef} tabIndex={-1} role="alert" aria-live="polite" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
