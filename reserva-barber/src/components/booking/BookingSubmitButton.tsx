'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/**
 * The submit control, disabled while a submission is in flight.
 *
 * **A courtesy, not a guard.** This state exists only after hydration, so a
 * fast double-tap before React attaches, or a client with JavaScript off,
 * still sends two requests. What actually prevents a double booking is the
 * transaction — and specifically its rule that the same client's own hold for
 * the same slot is returned rather than refused, which is what makes the
 * second request harmless instead of an error shown to someone who succeeded.
 *
 * It lives in its own client component because `useFormStatus` must be called
 * from a descendant of the `<form>`, and lifting the whole step to the client
 * would ship the deposit formatting and the copy module to the browser for
 * nothing.
 */
export function BookingSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.booking.submitting : COPY.booking.submit}
    </Button>
  );
}
