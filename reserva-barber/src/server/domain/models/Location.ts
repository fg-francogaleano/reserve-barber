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

/**
 * Zero-width code points. `trim()` does not remove these, so a name made only
 * of them would satisfy a length check and then render as an invisible card.
 */
const ZERO_WIDTH_CHARACTERS = /[​-‍﻿]/g;

/**
 * Canonical form of a location name, applied before validation and before
 * persistence (see `docs/data-model.md` §4). The database's unique constraint
 * compares bytes, so anything that reads as the same name to a person must be
 * reduced to the same bytes here — otherwise `Sucursal  Centro` with a double
 * space, and a decomposed-accent spelling of an existing name, both slip past
 * uniqueness while looking identical on screen.
 *
 * Order matters: NFC first (composition can itself produce whitespace-adjacent
 * changes), then strip zero-width characters, then collapse the remaining
 * whitespace — `\s` covers tabs, newlines and non-breaking spaces alike.
 */
export function normalizeLocationName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}
