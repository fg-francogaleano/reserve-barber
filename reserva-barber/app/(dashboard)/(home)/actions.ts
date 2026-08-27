'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { bookingCancellationService } from './bookingCancellationService';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import type { CancelFormState } from './formState';

const HOME_PATH = '/';

/** Generous, like every other bound on a value that arrives from outside. */
const MAX_ID_LENGTH = 64;

function readBookingId(formData: FormData): string | null {
  const value = formData.get('bookingId');
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

/**
 * The owner cancels a booking (C2).
 *
 * **A Server Action, matching every other write in this dashboard.** The public
 * flow uses Route Handlers because a guest halfway through paying must never
 * meet a build-time action id that has gone stale; an authenticated surface the
 * owner reloads freely has no such problem, and matching the receipt review is
 * what keeps the dashboard one thing.
 *
 * **The owner is resolved here and never trusted from the form.** The
 * submission carries a booking id and nothing else; the repository resolves it
 * inside the caller's own scope, so a booking belonging to another owner and
 * one that never existed produce the same outcome and the same message. A
 * differential answer would turn the dashboard into an oracle for which
 * bookings exist.
 *
 * **Neither refusal is an error.** A booking that moved between the render and
 * the submission — confirmed by a notification, swept by the sweeper, already
 * cancelled in another tab — is the guard working. It is reported as a plain
 * message asking for a refresh, not as a failure of the system.
 */
export async function cancelBookingAction(
  _prev: CancelFormState,
  formData: FormData
): Promise<CancelFormState> {
  const owner = await requireOwner();

  const bookingId = readBookingId(formData);
  if (bookingId === null) {
    return { error: COPY.dashboard.cancelNotFound, notice: null };
  }

  try {
    const result = await bookingCancellationService().cancel(bookingId, owner.id);

    switch (result.outcome) {
      case 'cancelled':
        revalidatePath(HOME_PATH);
        // **It says the slot is free and claims nothing about the client.**
        // Telling an owner somebody was notified when they were not removes
        // their reason to make contact by hand, which is the only recovery
        // this product offers (the rule N1 established).
        return { error: null, notice: COPY.dashboard.cancelled };

      case 'notCancellable':
        // Revalidated too: the page the owner is looking at is stale by
        // definition here, and the refresh is the actual remedy.
        revalidatePath(HOME_PATH);
        return { error: COPY.dashboard.cancelNotPossible, notice: null };

      case 'notFound':
        return { error: COPY.dashboard.cancelNotFound, notice: null };
    }
  } catch (error) {
    // The context carries an operation and an error name — never the client,
    // never the booking's contact detail, and never the submitted value.
    logger.error('Booking cancellation failed', toErrorLogContext('cancelBookingAction', error));
    return { error: COPY.dashboard.cancelFailed, notice: null };
  }
}
