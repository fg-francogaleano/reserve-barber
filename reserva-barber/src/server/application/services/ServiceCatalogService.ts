import type { Service } from '@/server/domain/models/Service';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';
import type {
  CreateServiceInput,
  UpdateServiceInput,
} from '@/server/application/servicesCatalog/serviceSchema';
import {
  ServiceNotFoundError,
  DuplicateServiceNameError,
  ServiceLimitReachedError,
} from '@/server/domain/errors/ServiceErrors';

/**
 * Advisory per-owner cap (design D8), counting **active** services only.
 *
 * Not a guarantee: the count and the insert are separate round trips against a
 * transaction-mode pooler with no database constraint behind the count, so
 * concurrent creates can exceed it. Recorded in `docs/tech-debt.md`.
 */
export const MAX_SERVICES_PER_OWNER = 50;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

export class ServiceCatalogService {
  constructor(private readonly services: IServiceRepository) {}

  listServices(ownerId: string): Promise<Service[]> {
    return this.services.findAllByOwner(ownerId);
  }

  findService(ownerId: string, id: string): Promise<Service | null> {
    return this.services.findByIdForOwner(id, ownerId);
  }

  async createService(ownerId: string, input: CreateServiceInput): Promise<Service> {
    const activeCount = await this.services.countActiveByOwner(ownerId);
    if (activeCount >= MAX_SERVICES_PER_OWNER) {
      throw new ServiceLimitReachedError();
    }

    await this.assertNameIsFree(ownerId, input.name);

    return this.writeOrTranslate(() => this.services.create(ownerId, input));
  }

  async updateService(ownerId: string, input: UpdateServiceInput): Promise<Service> {
    const { id, ...data } = input;

    // `excludeId` keeps the row being edited from being reported a duplicate of
    // itself when the owner saves an unchanged form.
    await this.assertNameIsFree(ownerId, data.name, id);

    // The ownership predicate travels with the write itself — no guard read.
    // A prior read plus an unscoped write is two decisions with only one of
    // them enforced (M1 design D7).
    const updated = await this.writeOrTranslate(() => this.services.update(id, ownerId, data));

    if (updated === null) {
      throw new ServiceNotFoundError();
    }
    return updated;
  }

  private async assertNameIsFree(ownerId: string, name: string, excludeId?: string): Promise<void> {
    const exists = await this.services.existsByOwnerAndName(ownerId, name, excludeId);
    if (exists) {
      throw new DuplicateServiceNameError();
    }
  }

  /**
   * Translates the one database violation this aggregate can produce.
   *
   * The translation is unconditional, which is correct **only while `Service`
   * participates in exactly one unique constraint**. M4 adds
   * `BarberService(barberId, serviceId)`; from then on an unrelated violation
   * would render a message about a name the owner never touched. Recorded with
   * M4 as the trigger rather than solved by reading `error.meta.target`, which
   * would drag Prisma's error shape into the application layer.
   */
  private async writeOrTranslate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new DuplicateServiceNameError();
      }
      throw error;
    }
  }
}
