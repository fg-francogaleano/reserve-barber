import 'server-only';
import { PaymentConfigService } from '@/server/application/services/PaymentConfigService';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/** Composition root for the transfer details editor. */
export function paymentConfigService(): PaymentConfigService {
  return new PaymentConfigService(new PrismaPaymentConfigRepository(getPrismaClient()));
}
