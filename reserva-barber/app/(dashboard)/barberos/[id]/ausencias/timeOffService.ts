import { BarberTimeOffService } from '@/server/application/services/BarberTimeOffService';
import { PrismaTimeOffRepository } from '@/server/infrastructure/prisma/PrismaTimeOffRepository';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/**
 * Composition root shared by the page and both actions.
 *
 * Not in `actions.ts`: that file carries `'use server'`, where every export is
 * compiled into a callable server action, so a synchronous factory export fails
 * the production build outright. M4 hit this wall; the shape is copied
 * deliberately.
 */
export function timeOffService(): BarberTimeOffService {
  const db = getPrismaClient();
  return new BarberTimeOffService(new PrismaTimeOffRepository(db), new PrismaBarberRepository(db));
}
