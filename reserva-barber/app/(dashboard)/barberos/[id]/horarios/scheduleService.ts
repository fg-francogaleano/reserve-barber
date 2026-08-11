import { BarberScheduleService } from '@/server/application/services/BarberScheduleService';
import { PrismaWorkingHoursRepository } from '@/server/infrastructure/prisma/PrismaWorkingHoursRepository';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/**
 * Composition root shared by the page and the action.
 *
 * It lives here rather than in `actions.ts` because that file carries
 * `'use server'`, where every export is compiled into a callable server action —
 * a synchronous factory export fails the production build outright. M4 hit this
 * exact wall; the shape is copied deliberately.
 */
export function scheduleService(): BarberScheduleService {
  const db = getPrismaClient();
  return new BarberScheduleService(
    new PrismaWorkingHoursRepository(db),
    new PrismaBarberRepository(db)
  );
}
