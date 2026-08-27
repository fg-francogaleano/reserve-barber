import 'server-only';
import { ClientBookingCancellationService } from '@/server/application/services/ClientBookingCancellationService';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public cancellation endpoint (C1).
 *
 * **Three collaborators, no optional arguments, and every one asserted by a
 * test over this file's source** (`clientCancellationService.test.ts` — the
 * claim and the test were written together, because N1's review and then C2's
 * each caught a root asserting a guarantee that did not exist). The reason the
 * guarantee needs a text-level test at all is B4's: its runtime found a
 * repository wired into one composer and not the other, invisible to a green
 * suite because the route tests mock the composer wholesale and the service
 * tests construct it directly. Nothing else ever runs the real composer.
 *
 * **This root is deliberately the smallest in the public flow.**
 *
 * - **No cipher.** B5 fixed at two the number of surfaces permitted to decrypt
 *   a stored Mercado Pago access token, and C1 does not become a third. That is
 *   also why this story does not close the client's open checkout when they
 *   cancel: doing so needs an authenticated call to Mercado Pago, on a path
 *   whose failure must not undo a cancellation that has already committed.
 * - **No email sender.** Nobody is notified. The client pressed the button and
 *   is looking at the page that reports the result; the owner learns from the
 *   dashboard, which counts this cancellation the moment `cancelledAt` is
 *   written and names the client on the row.
 * - **No storage and no Supabase client.** This write touches a booking and its
 *   payment, and reads nothing else.
 */
export function clientCancellationService(): ClientBookingCancellationService {
  return new ClientBookingCancellationService(
    new PrismaBookingRepository(getPrismaClient()),
    systemClock,
    logger
  );
}
