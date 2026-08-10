import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceCatalogService, MAX_SERVICES_PER_OWNER } from './ServiceCatalogService';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';
import { Service } from '@/server/domain/models/Service';
import {
  ServiceNotFoundError,
  DuplicateServiceNameError,
  ServiceLimitReachedError,
} from '@/server/domain/errors/ServiceErrors';

const OWNER = 'owner-1';
const SERVICE_ID = 'svc-1';

function makeService(): Service {
  return new Service(SERVICE_ID, 'Corte Clásico', null, '4500.00', 30, true);
}

const createInput = {
  name: 'Corte Clásico',
  description: null,
  price: '4500.00',
  durationMinutes: 30,
};

const updateInput = { id: SERVICE_ID, ...createInput };

type RepoMock = { [K in keyof IServiceRepository]: ReturnType<typeof vi.fn> };

function createRepo(): { services: IServiceRepository; sm: RepoMock } {
  const sm: RepoMock = {
    findAllByOwner: vi.fn().mockResolvedValue([]),
    findByIdForOwner: vi.fn().mockResolvedValue(null),
    countActiveByOwner: vi.fn().mockResolvedValue(0),
    existsByOwnerAndName: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
  };
  return { services: sm as unknown as IServiceRepository, sm };
}

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma ${code}`), { code });
}

beforeEach(() => vi.clearAllMocks());

// ─── createService ───────────────────────────────────────────────────────────

describe('ServiceCatalogService - createService', () => {
  it('should_create_the_service_when_the_name_is_free_and_the_cap_is_not_reached', async () => {
    const { services, sm } = createRepo();
    sm.create.mockResolvedValue(makeService());

    const result = await new ServiceCatalogService(services).createService(OWNER, createInput);

    expect(result.id).toBe(SERVICE_ID);
    expect(sm.create).toHaveBeenCalledWith(OWNER, createInput);
  });

  it('should_reject_when_the_active_cap_is_reached_before_writing', async () => {
    const { services, sm } = createRepo();
    sm.countActiveByOwner.mockResolvedValue(MAX_SERVICES_PER_OWNER);

    await expect(
      new ServiceCatalogService(services).createService(OWNER, createInput)
    ).rejects.toBeInstanceOf(ServiceLimitReachedError);
    expect(sm.create).not.toHaveBeenCalled();
  });

  it('should_count_only_active_services_against_the_cap', async () => {
    // Design D8: counting every row would let an owner who deactivated the
    // maximum become permanently unable to create another once M6 ships.
    const { services, sm } = createRepo();
    sm.create.mockResolvedValue(makeService());

    await new ServiceCatalogService(services).createService(OWNER, createInput);

    expect(sm.countActiveByOwner).toHaveBeenCalledWith(OWNER);
  });

  it('should_reject_a_duplicate_found_by_the_pre_check', async () => {
    const { services, sm } = createRepo();
    sm.existsByOwnerAndName.mockResolvedValue(true);

    await expect(
      new ServiceCatalogService(services).createService(OWNER, createInput)
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);
    expect(sm.create).not.toHaveBeenCalled();
  });

  it('should_scope_the_duplicate_pre_check_to_the_owner', async () => {
    const { services, sm } = createRepo();
    sm.create.mockResolvedValue(makeService());

    await new ServiceCatalogService(services).createService(OWNER, createInput);

    expect(sm.existsByOwnerAndName).toHaveBeenCalledWith(OWNER, 'Corte Clásico', undefined);
  });

  it('should_translate_a_unique_constraint_violation_into_a_duplicate_error', async () => {
    // The pre-check and the write are separate round trips on a transaction-mode
    // pooler, so the constraint is the only real guarantee.
    const { services, sm } = createRepo();
    sm.create.mockRejectedValue(prismaError('P2002'));

    await expect(
      new ServiceCatalogService(services).createService(OWNER, createInput)
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);
  });

  it('should_let_an_unrecognized_database_error_propagate', async () => {
    const { services, sm } = createRepo();
    sm.create.mockRejectedValue(prismaError('P1001'));

    await expect(
      new ServiceCatalogService(services).createService(OWNER, createInput)
    ).rejects.toThrow('Prisma P1001');
  });
});

// ─── updateService ───────────────────────────────────────────────────────────

describe('ServiceCatalogService - updateService', () => {
  it('should_update_the_service', async () => {
    const { services, sm } = createRepo();
    sm.update.mockResolvedValue(makeService());

    const result = await new ServiceCatalogService(services).updateService(OWNER, updateInput);

    expect(result.id).toBe(SERVICE_ID);
    expect(sm.update).toHaveBeenCalledWith(SERVICE_ID, OWNER, createInput);
  });

  it('should_not_report_an_unchanged_service_as_a_duplicate_of_itself', async () => {
    const { services, sm } = createRepo();
    sm.update.mockResolvedValue(makeService());

    await new ServiceCatalogService(services).updateService(OWNER, updateInput);

    expect(sm.existsByOwnerAndName).toHaveBeenCalledWith(OWNER, 'Corte Clásico', SERVICE_ID);
  });

  it('should_reject_when_the_name_collides_with_another_service', async () => {
    const { services, sm } = createRepo();
    sm.existsByOwnerAndName.mockResolvedValue(true);

    await expect(
      new ServiceCatalogService(services).updateService(OWNER, updateInput)
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);
    expect(sm.update).not.toHaveBeenCalled();
  });

  it('should_treat_a_zero_row_update_as_not_found_never_as_success', async () => {
    const { services, sm } = createRepo();
    sm.update.mockResolvedValue(null);

    await expect(
      new ServiceCatalogService(services).updateService(OWNER, updateInput)
    ).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it('should_carry_the_ownership_predicate_into_the_update_itself', async () => {
    // Not a guard read followed by an unscoped write: two decisions with only
    // one of them enforced is the pattern M1 design D7 forbids.
    const { services, sm } = createRepo();
    sm.update.mockResolvedValue(makeService());

    await new ServiceCatalogService(services).updateService(OWNER, updateInput);

    expect(sm.update).toHaveBeenCalledWith(SERVICE_ID, OWNER, expect.anything());
    expect(sm.findByIdForOwner).not.toHaveBeenCalled();
  });

  it('should_translate_a_unique_constraint_violation_on_update', async () => {
    const { services, sm } = createRepo();
    sm.update.mockRejectedValue(prismaError('P2002'));

    await expect(
      new ServiceCatalogService(services).updateService(OWNER, updateInput)
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);
  });

  it('should_not_apply_the_cap_to_an_edit', async () => {
    const { services, sm } = createRepo();
    sm.countActiveByOwner.mockResolvedValue(MAX_SERVICES_PER_OWNER);
    sm.update.mockResolvedValue(makeService());

    await expect(
      new ServiceCatalogService(services).updateService(OWNER, updateInput)
    ).resolves.toBeDefined();
  });
});

// ─── metacharacters (design D9) ──────────────────────────────────────────────

describe('ServiceCatalogService - metacharacter pass-through', () => {
  // The substantive proof that `%` and `_` are compared literally lives in
  // PrismaServiceRepository's test, where the in-memory comparison actually
  // runs. What the service owes is that it hands the name to the repository
  // **unmodified** — no escaping, no quoting, nothing that would make the
  // comparison operate on a different string than the one being stored.
  it.each(['Corte 50%', 'Corte_1', "Corte's", 'Corte\\1'])(
    'should_pass_%s_to_the_repository_unmodified',
    async (name) => {
      const { services, sm } = createRepo();
      sm.create.mockResolvedValue(makeService());

      await new ServiceCatalogService(services).createService(OWNER, { ...createInput, name });

      expect(sm.existsByOwnerAndName).toHaveBeenCalledWith(OWNER, name, undefined);
      expect(sm.create).toHaveBeenCalledWith(OWNER, expect.objectContaining({ name }));
    }
  );
});

// ─── reads ───────────────────────────────────────────────────────────────────

describe('ServiceCatalogService - reads', () => {
  it('should_scope_the_listing_to_the_owner', async () => {
    const { services, sm } = createRepo();
    await new ServiceCatalogService(services).listServices(OWNER);
    expect(sm.findAllByOwner).toHaveBeenCalledWith(OWNER);
  });

  it('should_scope_a_single_lookup_to_the_owner', async () => {
    const { services, sm } = createRepo();
    await new ServiceCatalogService(services).findService(OWNER, SERVICE_ID);
    expect(sm.findByIdForOwner).toHaveBeenCalledWith(SERVICE_ID, OWNER);
  });
});
