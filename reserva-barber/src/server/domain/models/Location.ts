/**
 * Domain entity representing a physical barbershop branch.
 * Zero external dependencies — pure domain model.
 */
export class Location {
  constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly name: string,
    public readonly address: string | null,
    public readonly isActive: boolean
  ) {}
}

export { normalizeName as normalizeLocationName } from './normalizeName';
