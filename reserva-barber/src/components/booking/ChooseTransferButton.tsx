'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/**
 * The control that commits to paying by bank transfer.
 *
 * **A courtesy, not a guard**, like every other submit in this flow. What
 * bounds a double-tap is the partial unique index `Payment_one_live_per_booking`
 * and the repository's rule that a booking with a live transfer payment is
 * answered with that same payment — and, deliberately, without extending the
 * deadline a second time.
 *
 * `variant="outline"` rather than the primary style: where both methods are
 * offered, Mercado Pago confirms the booking on its own and this one needs a
 * human to review a file. Presenting them as equals would invite the slower
 * path by accident.
 */
export function ChooseTransferButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {COPY.booking.payWithTransfer}
    </Button>
  );
}
