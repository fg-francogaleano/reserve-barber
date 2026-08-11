import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BarberServiceAssignmentService } from './BarberServiceAssignmentService';
import { Barber } from '@/server/domain/models/Barber';
import { Service } from '@/server/domain/models/Service';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { ServiceNotAssignableError } from '@/server/domain/errors/BarberServiceErrors';
import type { IBarberServiceRepository } from '@/server/domain/repositories/IBarberServiceRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

const CORTE = new Service('svc-corte', 'Corte', null, '4500.00', 30, true);
const BARBA = new Service('svc-barba', 'Barba', null, '2500.00', 20, true);
const COLOR = new Service('svc-color', 'Color', null, '8000.00', 60, true);
const RETIRED = new Service('svc-retired', 'Servicio Viejo', null, '1000.00', 15, false);

const ALL_SERVICES = [CORTE, BARBA, COLOR, RETIRED];

function makeService(overrides: {
  assigned?: string[];
  barber?: Barber | null;
  services?: Service[];
}) {
  const assignments = {
    findServiceIdsForBarber: vi.fn().mockResolvedValue(overrides.assigned ?? []),
    setForBarber: vi.fn().mockResolvedValue(undefined),
    countServicesByBarber: vi.fn().mockResolvedValue(new Map()),
    countActiveBarbersByService: vi.fn().mockResolvedValue(new Map()),
  } satisfies Record<keyof IBarberServiceRepository, ReturnType<typeof vi.fn>>;

  const barbers = {
    findByIdForOwner: vi
      .fn()
      .mockResolvedValue(
        overrides.barber === undefined ? new Barber(BARBER, 'loc-1', 'Ana', null, true) : overrides.barber
      ),
    findAllByOwner: vi.fn(),
    countByLocation: vi.fn(),
    existsByLocationAndName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const services = {
    findAllByOwner: vi.fn().mockResolvedValue(overrides.services ?? ALL_SERVICES),
    findByIdForOwner: vi.fn(),
    countActiveByOwner: vi.fn(),
    existsByOwnerAndName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const sut = new BarberServiceAssignmentService(
    assignments as unknown as IBarberServiceRepository,
    barbers as unknown as IBarberRepository,
    services as unknown as IServiceRepository
  );

  return { sut, assignments, barbers, services };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BarberServiceAssignmentService - the diff', () => {
  it('should_add_checked_services_that_are_not_stored', async () => {
    const { sut, assignments } = makeService({ assigned: [] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [CORTE.id, BARBA.id],
      renderedServiceIds: [CORTE.id, BARBA.id, COLOR.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [CORTE.id, BARBA.id],
      toRemove: [],
    });
  });

  it('should_remove_rendered_services_that_were_unchecked', async () => {
    const { sut, assignments } = makeService({ assigned: [CORTE.id, BARBA.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [BARBA.id],
      renderedServiceIds: [CORTE.id, BARBA.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [],
      toRemove: [CORTE.id],
    });
  });

  it('should_add_and_remove_in_one_call', async () => {
    const { sut, assignments } = makeService({ assigned: [CORTE.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [BARBA.id],
      renderedServiceIds: [CORTE.id, BARBA.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [BARBA.id],
      toRemove: [CORTE.id],
    });
  });
});

describe('BarberServiceAssignmentService - the rendered baseline bounds removals', () => {
  it('should_not_remove_an_assignment_absent_from_the_rendered_baseline', async () => {
    // COLOR was assigned by another session after this form was rendered.
    const { sut, assignments } = makeService({ assigned: [CORTE.id, BARBA.id, COLOR.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [CORTE.id],
      renderedServiceIds: [CORTE.id, BARBA.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [],
      toRemove: [BARBA.id],
    });
  });

  it('should_not_remove_anything_when_the_baseline_is_disjoint_from_stored', async () => {
    const { sut, assignments } = makeService({ assigned: [COLOR.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: [CORTE.id, BARBA.id],
    });

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });
});

describe('BarberServiceAssignmentService - ownership', () => {
  it('should_reject_an_unknown_or_foreign_barber', async () => {
    const { sut, assignments } = makeService({ barber: null });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [CORTE.id],
        renderedServiceIds: [CORTE.id],
      })
    ).rejects.toBeInstanceOf(BarberNotFoundError);

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_reject_a_checked_service_the_owner_does_not_own', async () => {
    const { sut, assignments } = makeService({ assigned: [] });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [CORTE.id, 'svc-someone-else'],
        renderedServiceIds: [CORTE.id, 'svc-someone-else'],
      })
    ).rejects.toBeInstanceOf(ServiceNotAssignableError);

    // Rejected in full: the valid id in the same submission is not written either.
    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_reject_a_rendered_service_the_owner_does_not_own', async () => {
    const { sut, assignments } = makeService({ assigned: [] });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [CORTE.id],
        renderedServiceIds: [CORTE.id, 'svc-someone-else'],
      })
    ).rejects.toBeInstanceOf(ServiceNotAssignableError);

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_not_name_a_service_it_cannot_see', async () => {
    const { sut } = makeService({ assigned: [] });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: ['svc-someone-else'],
        renderedServiceIds: ['svc-someone-else'],
      })
    ).rejects.toMatchObject({ serviceName: '' });
  });
});

describe('BarberServiceAssignmentService - inactive services', () => {
  it('should_keep_an_inactive_service_that_is_already_assigned', async () => {
    const { sut, assignments } = makeService({ assigned: [RETIRED.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [RETIRED.id],
      renderedServiceIds: [RETIRED.id, CORTE.id],
    });

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_refuse_to_add_an_inactive_service_that_is_not_assigned', async () => {
    const { sut, assignments } = makeService({ assigned: [] });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [RETIRED.id],
        renderedServiceIds: [RETIRED.id, CORTE.id],
      })
    ).rejects.toBeInstanceOf(ServiceNotAssignableError);

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_name_the_offending_inactive_service', async () => {
    const { sut } = makeService({ assigned: [] });

    await expect(
      sut.setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [RETIRED.id],
        renderedServiceIds: [RETIRED.id],
      })
    ).rejects.toMatchObject({ serviceName: RETIRED.name });
  });

  it('should_allow_unassigning_an_inactive_service', async () => {
    const { sut, assignments } = makeService({ assigned: [RETIRED.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: [RETIRED.id, CORTE.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [],
      toRemove: [RETIRED.id],
    });
  });
});

describe('BarberServiceAssignmentService - no-op saves', () => {
  it('should_issue_no_write_when_the_submission_changes_nothing', async () => {
    const { sut, assignments } = makeService({ assigned: [CORTE.id, BARBA.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [CORTE.id, BARBA.id],
      renderedServiceIds: [CORTE.id, BARBA.id, COLOR.id],
    });

    expect(assignments.setForBarber).not.toHaveBeenCalled();
  });

  it('should_succeed_when_unassigning_everything', async () => {
    const { sut, assignments } = makeService({ assigned: [CORTE.id, BARBA.id] });

    await sut.setServices(OWNER, {
      barberId: BARBER,
      serviceIds: [],
      renderedServiceIds: [CORTE.id, BARBA.id],
    });

    expect(assignments.setForBarber).toHaveBeenCalledWith(BARBER, OWNER, {
      toAdd: [],
      toRemove: [CORTE.id, BARBA.id],
    });
  });
});

describe('BarberServiceAssignmentService - editor data', () => {
  it('should_expose_active_services_plus_those_already_assigned', async () => {
    const { sut } = makeService({ assigned: [RETIRED.id] });

    const data = await sut.getEditorData(OWNER, BARBER);

    expect(data?.assignable.map((service) => service.id)).toEqual([
      CORTE.id,
      BARBA.id,
      COLOR.id,
      RETIRED.id,
    ]);
    expect(data?.assignedIds).toEqual([RETIRED.id]);
  });

  it('should_exclude_an_inactive_service_that_is_not_assigned', async () => {
    const { sut } = makeService({ assigned: [] });

    const data = await sut.getEditorData(OWNER, BARBER);

    expect(data?.assignable.map((service) => service.id)).not.toContain(RETIRED.id);
  });

  it('should_return_null_for_an_unknown_or_foreign_barber', async () => {
    const { sut } = makeService({ barber: null });

    await expect(sut.getEditorData(OWNER, BARBER)).resolves.toBeNull();
  });
});

// ─── T15 — the assignment write must not inherit a duplicate-name translation ─

describe('BarberServiceAssignmentService - unique-violation translation is not inherited', () => {
  it('should_let_a_P2002_propagate_rather_than_naming_it_a_duplicate_name', async () => {
    const { sut, assignments } = makeService({ assigned: [] });
    const violation = Object.assign(new Error('Prisma P2002'), { code: 'P2002' });
    assignments.setForBarber.mockRejectedValueOnce(violation);

    const caught = await sut
      .setServices(OWNER, {
        barberId: BARBER,
        serviceIds: [CORTE.id],
        renderedServiceIds: [CORTE.id],
      })
      .catch((error: unknown) => error);

    // The two catalogue services translate P2002 unconditionally into their own
    // duplicate-name errors. That stays correct only while each aggregate has
    // one reachable unique constraint — M4 adds a second one on a third table.
    // The bound is kept by construction: assignments are written through their
    // own repository, never nested in a Service or Barber write, so no
    // translation can reach them. This asserts that boundary rather than
    // trusting it.
    expect(caught).toBe(violation);
    expect((caught as { name?: string }).name).not.toBe('DuplicateServiceNameError');
    expect((caught as { name?: string }).name).not.toBe('DuplicateBarberNameError');
  });
});
