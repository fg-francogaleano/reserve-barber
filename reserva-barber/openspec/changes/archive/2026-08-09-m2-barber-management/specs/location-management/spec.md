## MODIFIED Requirements

### Requirement: Location name is validated and normalized
Location `name` SHALL be normalized before validation and persistence by applying Unicode NFC normalization, removing zero-width and **bidirectional control** characters, collapsing runs of internal whitespace to a single space, and trimming surrounding whitespace. After normalization the name MUST be between 2 and 120 characters. `address` SHALL be trimmed, MUST NOT exceed 255 characters, and a blank value MUST be stored as `null`. Validation SHALL run server-side before any business logic, regardless of what the browser enforced.

This normalization is a **shared domain rule**, not a location-specific one. It SHALL live in a single domain module consumed by every entity whose name is subject to a uniqueness constraint, so that two entities cannot drift into disagreeing about what "the same name" means.

Bidirectional control characters (U+202A–U+202E, U+2066–U+2069) are removed for the same reason zero-width characters are: they are invisible, they survive a length check, and they defeat the uniqueness constraint by making two names that render identically differ in bytes. Unlike zero-width characters they also reverse the rendering direction of *surrounding* text, so a single crafted name corrupts the display of the rows next to it.

#### Scenario: Surrounding and internal whitespace normalized
- **WHEN** the owner submits "  Sucursal   Centro  "
- **THEN** the persisted name is "Sucursal Centro"

#### Scenario: Name below or above the length bounds
- **WHEN** the owner submits a name of 1 character, or of 121 characters
- **THEN** a field-level Spanish error renders on the name input and nothing is persisted

#### Scenario: Whitespace-only and zero-width names rejected
- **WHEN** the owner submits a name consisting only of spaces, or only of zero-width characters
- **THEN** it is treated as empty and rejected by the required rule

#### Scenario: Bidirectional control characters removed
- **WHEN** the owner submits a name containing a bidirectional override or isolate character
- **THEN** the character is removed before validation and persistence
- **THEN** two names differing only by such characters cannot both be stored for one owner

#### Scenario: Address at the boundary
- **WHEN** the owner submits an address of 256 characters
- **THEN** a field-level Spanish error renders and nothing is persisted

#### Scenario: The rule has one home
- **WHEN** the codebase is inspected for name normalization
- **THEN** exactly one domain module implements it and every consumer imports it
