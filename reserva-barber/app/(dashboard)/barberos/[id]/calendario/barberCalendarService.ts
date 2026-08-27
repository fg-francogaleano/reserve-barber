import 'server-only';
import { BarberCalendarService } from '@/server/application/services/BarberCalendarService';
import { PrismaBarberCalendarRepository } from '@/server/infrastructure/prisma/PrismaBarberCalendarRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { hasTimezoneSupport } from '@/server/domain/models/businessTime';
import { TimezoneUnavailableError } from '@/server/application/services/PublicAvailabilityService';

/**
 * Composition root for the per-barber calendar.
 *
 * **Thinner than the dashboard home's, which held the record.** Two
 * collaborators: one repository and a clock. No logger is wired *into* the
 * service, because the service decides nothing it could report — the page logs
 * its own failed read. No cipher, because nothing here touches a Mercado Pago
 * credential; no storage client, because nothing signs a file; no Supabase
 * session client, because nothing is scoped by a bucket policy. The count of
 * surfaces permitted to decrypt a credential is unchanged by this story, and
 * every claim in this comment is asserted by a test over this file's source.
 *
 * **The timezone check happens here, before the repository is built.** That is
 * the only place early enough that no wrong day can be computed: the service
 * holds the same invariant for any caller that did not come through this root,
 * but by then a range has already been chosen. The runtime is UTC and the
 * business is at UTC−3, so a missing timezone does not fail — it answers with a
 * plausible number for the wrong day.
 */
export function barberCalendarService(): BarberCalendarService {
  if (!hasTimezoneSupport()) {
    throw new TimezoneUnavailableError();
  }

  return new BarberCalendarService(
    new PrismaBarberCalendarRepository(getPrismaClient()),
    systemClock
  );
}
