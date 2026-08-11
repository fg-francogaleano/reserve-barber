import type { Barber } from '@/server/domain/models/Barber';
import type { Service } from '@/server/domain/models/Service';
import type {
  IBarberServiceRepository,
  AssignmentDiff,
} from '@/server/domain/repositories/IBarberServiceRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';
import type { SetBarberServicesInput } from '@/server/application/barberServices/barberServicesSchema';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { ServiceNotAssignableError } from '@/server/domain/errors/BarberServiceErrors';

export interface AssignmentEditorData {
  barber: Barber;
  /** Active services plus any inactive one already assigned (design D9). */
  assignable: Service[];
  assignedIds: string[];
}

/**
 * The **only** permitted writer of the BarberService table (design D6).
 *
 * The same-owner rule has no database backing — `Barber` has no `ownerId`
 * column, so no constraint can compare the two sides — which makes this class
 * the entire guarantee. A second write path would not be a duplication, it
 * would be a hole.
 */
export class BarberServiceAssignmentService {
  constructor(
    private readonly assignments: IBarberServiceRepository,
    private readonly barbers: IBarberRepository,
    private readonly services: IServiceRepository
  ) {}

  /** Returns `null` when the barber is unknown or belongs to another owner. */
  async getEditorData(ownerId: string, barberId: string): Promise<AssignmentEditorData | null> {
    const barber = await this.barbers.findByIdForOwner(barberId, ownerId);
    if (!barber) {
      return null;
    }

    const [all, assignedIds] = await Promise.all([
      this.services.findAllByOwner(ownerId),
      this.assignments.findServiceIdsForBarber(barberId, ownerId),
    ]);

    const assigned = new Set(assignedIds);
    return {
      barber,
      assignable: all.filter((service) => service.isActive || assigned.has(service.id)),
      assignedIds,
    };
  }

  async setServices(ownerId: string, input: SetBarberServicesInput): Promise<void> {
    // The ownership predicate is resolved before anything else: an unknown or
    // foreign barber must not even reveal which services exist.
    const barber = await this.barbers.findByIdForOwner(input.barberId, ownerId);
    if (!barber) {
      throw new BarberNotFoundError();
    }

    const [all, storedIds] = await Promise.all([
      this.services.findAllByOwner(ownerId),
      this.assignments.findServiceIdsForBarber(input.barberId, ownerId),
    ]);

    const byId = new Map(all.map((service) => [service.id, service]));
    const stored = new Set(storedIds);

    // Every submitted id — checked and rendered alike — must belong to the
    // owner. A foreign id rejects the whole submission rather than being
    // filtered out: a silently dropped id means the save did something other
    // than what the form showed.
    for (const id of [...input.serviceIds, ...input.renderedServiceIds]) {
      if (!byId.has(id)) {
        // No name: an id the owner cannot see has none to report, and
        // inventing one would leak whether it exists.
        throw new ServiceNotAssignableError('');
      }
    }

    const toAdd = input.serviceIds.filter((id) => !stored.has(id));

    // Only *additions* are held to the active rule. An inactive service already
    // assigned stays assigned (design D9) — it appears in `stored`, so it is
    // never an addition and never reaches this check.
    for (const id of toAdd) {
      const service = byId.get(id);
      if (!service) {
        throw new ServiceNotAssignableError('');
      }
      if (!service.isActive) {
        throw new ServiceNotAssignableError(service.name, service.id);
      }
    }

    const checked = new Set(input.serviceIds);
    // Removals are confined to what the form rendered (design D3). An
    // assignment created after this page loaded is absent from the baseline and
    // therefore survives a save that never mentioned it.
    const toRemove = input.renderedServiceIds.filter((id) => !checked.has(id) && stored.has(id));

    const diff: AssignmentDiff = { toAdd, toRemove };
    if (toAdd.length === 0 && toRemove.length === 0) {
      // An unchanged save is a success with nothing to write. Issuing an empty
      // transaction would spend a pooled connection to accomplish nothing.
      return;
    }

    await this.assignments.setForBarber(input.barberId, ownerId, diff);
  }
}
