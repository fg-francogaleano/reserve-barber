## MODIFIED Requirements

### Requirement: Test toolchain with coverage thresholds
The project SHALL run unit tests with Vitest. Coverage on `src/server/domain` and `src/server/application` MUST meet a 90% threshold for branches, functions, lines, and statements, enforced by `vitest.config.ts`. Tests live alongside sources as `*.test.ts` and MUST NOT touch a real database.

The toolchain SHALL additionally support component tests written with React Testing Library against a jsdom environment, living alongside their components as `*.test.tsx`. Component tests MUST assert observable behaviour — querying by role and label rather than by internal state or implementation detail — and MUST NOT open a database connection or invoke a real Server Action. The 90% coverage threshold applies to the domain and application layers only; component tests are not counted toward it, so UI coverage never inflates the gate that protects business rules.

The limits of the jsdom environment SHALL be recorded rather than papered over: behaviour that depends on a real browser or on a real HTTP response — screen-reader announcement, and the HTTP status code an action responds with — is not observable here and remains covered only by manual verification.

#### Scenario: Coverage gate fails below threshold
- **WHEN** coverage on domain or application layers drops below 90%
- **THEN** `npm run test:coverage` exits non-zero

#### Scenario: Service tested against mocked repository
- **WHEN** `LocationService` tests run
- **THEN** they use a mocked `ILocationRepository` (returning data, empty list, and a thrown error) and no database connection is opened

#### Scenario: Component test runs under jsdom
- **WHEN** a `*.test.tsx` component test runs
- **THEN** it renders under the jsdom environment, queries by role or label, and opens no database connection

#### Scenario: Component coverage does not count toward the domain gate
- **WHEN** `npm run test:coverage` runs
- **THEN** the 90% threshold is evaluated over `src/server/domain` and `src/server/application` only
