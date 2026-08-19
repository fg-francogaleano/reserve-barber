'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/**
 * The control that opens — or reopens — the Mercado Pago checkout.
 *
 * **A courtesy, not a guard**, exactly as `BookingSubmitButton` is. The
 * disabled state only exists after hydration, so a fast double-tap before
 * React attaches, or a client with JavaScript off, still sends two requests.
 * What actually prevents two charges is the partial unique index
 * `Payment_one_live_per_booking` and the initiation service's rule that a
 * booking with a live checkout is answered with that same checkout — which is
 * what makes the second request harmless rather than an error shown to
 * somebody who succeeded.
 *
 * `resuming` changes only the label. The endpoint is the same and it is
 * idempotent, so there is no second path to keep correct — the client is just
 * told accurately which of the two things they are doing.
 */
export function PayDepositButton({ resuming = false }: { resuming?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? COPY.booking.payDepositSubmitting
        : resuming
          ? COPY.booking.resumePayment
          : COPY.booking.payDeposit}
    </Button>
  );
}
