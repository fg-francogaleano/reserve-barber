import 'server-only';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';

/**
 * Composition root for the hold-confirmation page.
 *
 * Still **one repository and nothing else**: no Supabase client, no cipher, no
 * payment repository. What changed in B6 is what that one repository reads.
 *
 * The page now has to render a CBU, which lives in the same row as the
 * encrypted Mercado Pago access token — so the claim this comment used to make,
 * that "no live payment configuration is consulted", stopped being true and is
 * replaced rather than quietly left standing. The guarantee changes shape
 * instead of disappearing, the way it did at B4 and B5:
 *
 * - The three transfer columns are **plaintext by design** (`data-model.md`
 *   §14) — they are shown verbatim to every client who chooses transfer — so
 *   reading them needs no cipher and none is wired here.
 * - `mpAccessToken` is **never selected**. Its presence is derived in SQL as a
 *   boolean, so the credential does not enter the process at all, and
 *   `BookingByToken` has no field it could occupy.
 * - The read stays inside `PrismaBookingRepository` rather than being composed
 *   from a second repository here, because a `PaymentConfig` read is keyed by
 *   `ownerId` and **B2 established that the owner id never reaches a page**.
 *   Composing it at this level would have meant putting one on the projection.
 * - The destination itself is `null` unless the booking has committed to
 *   transfer, so the page cannot render an account number to somebody whose
 *   hold is about to lapse.
 */
export function bookingConfirmationService(): IBookingRepository {
  return new PrismaBookingRepository(getPrismaClient());
}
