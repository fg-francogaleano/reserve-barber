import 'server-only';
import { ClientDirectoryService } from '@/server/application/services/ClientDirectoryService';
import { PrismaClientDirectoryRepository } from '@/server/infrastructure/prisma/PrismaClientDirectoryRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/**
 * Composition root for the clients directory.
 *
 * **One collaborator, and the shortest root in the project.** This page reads
 * one table and writes nothing: no clock, because nothing here asks what day it
 * is; no cipher, because nothing touches a Mercado Pago credential; no storage
 * client, because nothing signs a file; no Supabase session client, because
 * nothing is scoped by a bucket policy; no mail sender and no booking
 * repository, because this story has no write path at all. The count of
 * surfaces permitted to decrypt a credential is unchanged by D4, and every
 * claim in this comment is asserted by a test over this file's source.
 *
 * The logger is deliberately **not** wired into the service: the service
 * decides nothing it could report, and the page logs its own failed read with
 * an operation name and an error name — never a client's name, address or
 * telephone number.
 */
export function clientDirectoryService(): ClientDirectoryService {
  return new ClientDirectoryService(new PrismaClientDirectoryRepository(getPrismaClient()));
}
