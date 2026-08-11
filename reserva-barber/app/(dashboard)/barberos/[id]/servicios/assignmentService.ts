import { BarberServiceAssignmentService } from '@/server/application/services/BarberServiceAssignmentService';
import { PrismaBarberServiceRepository } from '@/server/infrastructure/prisma/PrismaBarberServiceRepository';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { PrismaServiceRepository } from '@/server/infrastructure/prisma/PrismaServiceRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/**
 * Composition root for the assignment editor, shared by the page and the action.
 *
 * It lives here rather than in `actions.ts` because that file carries
 * `'use server'`, and every export of a `'use server'` module is compiled into a
 * callable server action — so a synchronous factory export fails the build
 * outright ("Server Actions must be async functions"). The page needs the same
 * wiring, so the choice is this module or a duplicated constructor call.
 */
export function assignmentService(): BarberServiceAssignmentService {
  const db = getPrismaClient();
  return new BarberServiceAssignmentService(
    new PrismaBarberServiceRepository(db),
    new PrismaBarberRepository(db),
    new PrismaServiceRepository(db)
  );
}
