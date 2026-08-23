'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/**
 * The control that sends the receipt.
 *
 * **A courtesy, not a guard**, exactly as `PayDepositButton` and
 * `BookingSubmitButton` are. The disabled state only exists after hydration, so
 * a fast double-tap before React attaches, or a client with JavaScript off,
 * still sends two requests. What actually bounds this is the per-booking
 * submission cap checked against the database, and the rule that a replacement
 * updates the existing row rather than inserting a second — which is what makes
 * the second request harmless instead of an error shown to somebody who
 * succeeded.
 *
 * The pending label earns more here than on the other two: a multipart body of
 * several megabytes over mobile data takes seconds, and a control that looked
 * inert for that long would invite the tap the cap then has to refuse.
 */
export function SubmitReceiptButton({ replacing = false }: { replacing?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? COPY.booking.receiptSubmitting
        : replacing
          ? COPY.booking.receiptReplace
          : COPY.booking.receiptSubmit}
    </Button>
  );
}
