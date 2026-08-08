---
description: >
  Backend development standards, best practices, and architectural conventions for
  Reserva Barber. The backend is the server side of a Next.js (App Router) application
  deployed to Cloudflare, using Prisma ORM against a Supabase PostgreSQL database.
  Follows Domain-Driven Design (DDD) and a layered architecture.
globs: []
alwaysApply: true
---

# Backend Project Standards and Best Practices
## Reserva Barber

> The backend follows **Domain-Driven Design (DDD)** and a layered architecture to ensure
> code consistency, maintainability, and scalability. The stack-agnostic principles below are
> mandatory; the stack-specific details are bound to the decisions in `project-context.md`.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Architecture Overview](#architecture-overview)
- [Domain-Driven Design Principles](#domain-driven-design-principles)
- [SOLID and DRY Principles](#solid-and-dry-principles)
- [Coding Standards](#coding-standards)
- [API Design Standards](#api-design-standards)
- [Database Patterns](#database-patterns)
- [Booking & Payment Domain Rules](#booking--payment-domain-rules)
- [Testing Standards](#testing-standards)
- [Performance Best Practices](#performance-best-practices)
- [Security Best Practices](#security-best-practices)
- [Development Workflow](#development-workflow)
- [Deployment](#deployment)

---

## Overview

This document outlines the best practices, conventions, and standards for the backend of
**Reserva Barber**. The "backend" here is the server-side of a single Next.js application:
Route Handlers (`app/api/**/route.ts`), Server Actions, and server-only modules. It exposes
a private admin surface (the owner dashboard) and a public surface (the guest booking flow),
and integrates Mercado Pago, Supabase Storage, and a transactional email provider.

---

## Technology Stack

### Core Technologies
- **Runtime:** Cloudflare Workers (`workerd`) via `@opennextjs/cloudflare`. **Not** a Node.js server — code must be compatible with the Workers runtime (Web APIs, no `fs`/native Node addons at runtime).
- **Language:** TypeScript with `strict` mode enabled — type-safe development, no implicit `any`.
- **Framework:** Next.js (App Router). Server logic lives in Route Handlers and Server Actions.

### Database & ORM
- **Database:** PostgreSQL, hosted on **Supabase**.
- **ORM / Query layer:** **Prisma Client** with **driver adapters** (`@prisma/adapter-pg`) so it runs on the Workers runtime. Connect through the **Supabase connection pooler (Supavisor)**, not a direct connection, and enable Prisma `driverAdapters`/query-compiler so no native engine binary is required.
- **Migration tool:** **Prisma Migrate** (`prisma migrate`). `prisma/schema.prisma` is the single source of truth for the schema.
- **Object storage:** **Supabase Storage** for profile/cover images, barber avatars, and transfer receipts. The DB stores only URLs/paths.

### Testing Framework
- **Test runner:** **Vitest** (fast, TS-native, Workers-friendly).
- **Coverage threshold:** 90% for branches, functions, lines, and statements on domain and application layers.
- **Test location:** alongside source files (`*.test.ts`).

### Development Tools
- **Linter:** ESLint (with `@typescript-eslint`).
- **Formatter:** Prettier.
- **Type checker:** `tsc --noEmit`.
- **Deployment:** `@opennextjs/cloudflare` + Wrangler to Cloudflare.
- **External integrations:** Mercado Pago (Checkout Pro / Preferences + webhook), Resend (email).

---

## Architecture Overview

### Domain-Driven Design (DDD)

> ✅ **Stack-agnostic principle — apply as-is.**

Domain-Driven Design focuses on modeling software according to business logic and domain
knowledge. Centering development on a deep understanding of the domain facilitates building
complex systems.

**Benefits:**
- **Improved Communication:** promotes a ubiquitous language between developers and domain experts.
- **Clear Domain Models:** models accurately reflect business rules (bookings, deposits, availability).
- **High Maintainability:** bounded contexts and subdomains ease maintenance and evolution.

### Layered Architecture

> ✅ **Principle is stack-agnostic; folder names adapted to a Next.js project.**

The backend follows a layered DDD architecture with four layers. In a Next.js app, the
framework-facing "presentation" layer is the set of Route Handlers and Server Actions; the
other three layers live under a framework-independent `src/server/` tree so they stay portable
and unit-testable without Next.js.

**Presentation Layer** (`app/api/**/route.ts`, Server Actions in `app/**/actions.ts`)
- Parse/validate the HTTP request or action input, call an application service, format the response.
- Contains **no** business logic — it delegates everything to the Application layer.

**Application Layer** (`src/server/application/`)
- Services orchestrate business logic and coordinate domain objects (e.g., `BookingService`).
- Input validation via DTOs / Zod schemas lives here.
- Services depend on **repository interfaces**, never concrete implementations.

**Domain Layer** (`src/server/domain/`)
- Core business entities and value objects (e.g., `Booking`, `TimeSlot`, `Money`).
- Repository interfaces (contracts).
- Pure business logic with zero external dependencies (no Prisma, no fetch).

**Infrastructure Layer** (`src/server/infrastructure/`)
- Concrete repository implementations using Prisma.
- External adapters: Mercado Pago client, Supabase Storage, Resend email, logger.
- Prisma client + driver adapter setup.

### Project Structure

```
barber/
├── app/                              # Next.js App Router (presentation)
│   ├── (dashboard)/                  # Private owner dashboard routes
│   ├── b/[slug]/                     # Public booking flow (guest)
│   └── api/
│       ├── bookings/route.ts
│       ├── webhooks/mercadopago/route.ts
│       └── ...
├── src/
│   └── server/
│       ├── domain/
│       │   ├── models/               # Booking, Barber, Service, Money, TimeSlot...
│       │   └── repositories/         # IBookingRepository, IBarberRepository... (contracts)
│       ├── application/
│       │   ├── services/             # BookingService, AvailabilityService, PaymentService...
│       │   ├── auth/                  # loginSchema, routeGuard, throttle...
│       │   └── locations/             # locationSchema... (one folder per feature)
│       └── infrastructure/
│           ├── prisma/               # client.ts (driver adapter + Supavisor), repositories
│           ├── payments/             # MercadoPagoClient
│           ├── storage/              # SupabaseStorage adapter
│           ├── email/                # ResendEmailSender
│           └── logger.ts
├── prisma/
│   ├── schema.prisma                 # Single source of truth for the schema
│   └── migrations/
├── src/components/                   # (see frontend-standards.md)
└── open-next.config.ts / wrangler.toml
```

---

## Domain-Driven Design Principles

> ✅ All principles are stack-agnostic. Code examples are in TypeScript using the Reserva Barber domain.

### Entities

Entities are objects with a distinct identity that persists over time (e.g., a `Booking`).

```typescript
// src/server/domain/models/Booking.ts
export type BookingStatus =
  | 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export class Booking {
  constructor(
    public readonly id: string,
    public readonly barberId: string,
    public readonly serviceId: string,
    public readonly clientId: string,
    public readonly startTime: Date,
    public readonly endTime: Date,
    public status: BookingStatus,
  ) {}

  /** Business rule lives in the entity, not in a controller. */
  confirm(): void {
    if (this.status !== 'PENDING_PAYMENT' && this.status !== 'PENDING_APPROVAL') {
      throw new InvalidBookingTransitionError(`Cannot confirm a booking in status ${this.status}`);
    }
    this.status = 'CONFIRMED';
  }
}
```

**Best Practice:** Entities encapsulate business logic related to their concept and maintain the consistency of their internal state.

### Value Objects

Value Objects describe aspects of the domain without conceptual identity — defined by their attributes.

```typescript
// src/server/domain/models/TimeSlot.ts
export class TimeSlot {
  constructor(public readonly start: Date, public readonly end: Date) {
    if (end <= start) throw new Error('TimeSlot end must be after start');
  }
  overlaps(other: TimeSlot): boolean {
    return this.start < other.end && other.start < this.end;
  }
}
```

`Money` (amount + currency ARS), `TimeSlot`, and `DepositPolicy` are Value Objects: they have no identity of their own.

### Aggregates

Aggregates are clusters of domain objects treated as a unit, with a root entity enforcing invariants.

- `Booking` is an aggregate root; its `Payment`(s) and `TransferReceipt` are mutated **through** the booking's use cases, preserving the invariant "a CONFIRMED booking must have an APPROVED payment".
- `Barber` is an aggregate root for its `WorkingHours` and `TimeOff`.

**Recommendation:** operations affecting child objects go through the aggregate root to maintain integrity.

### Repositories

Repositories provide interfaces for accessing aggregates, hiding all data-access logic behind a clean contract.

```typescript
// Domain layer — contract only (src/server/domain/repositories/IBookingRepository.ts)
export interface IBookingRepository {
  findById(id: string): Promise<Booking | null>;
  findOverlapping(barberId: string, slot: TimeSlot): Promise<Booking[]>;
  save(booking: Booking): Promise<Booking>;
}

// Infrastructure layer — Prisma implementation
export class PrismaBookingRepository implements IBookingRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<Booking | null> {
    const row = await this.db.booking.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
}
```

**Recommendations:** one repository per aggregate root; all DB access for an entity passes through its repository; inject the `PrismaClient` via constructor (testability + DIP).

### Domain Services

Domain Services hold business logic that doesn't belong to a single entity — e.g., `AvailabilityService.generateSlots(barber, service, date)` which combines `WorkingHours`, `TimeOff`, existing bookings, and `service.durationMinutes`.

### Additional Recommendations
- **Factories:** use a `BookingFactory` to build a valid `Booking` (computes `endTime` from the service duration, `depositAmount` from `PaymentConfig`, and a random `cancellationToken`).
- **Domain Events:** emit events like `BookingConfirmed` to decouple side effects (send confirmation email) from the confirmation logic.
- **Relationship Modeling:** relationships must reflect real domain rules (see `data-model.md`).

---

## SOLID and DRY Principles

> ✅ Language-agnostic; examples in TypeScript.

- **SRP:** validation lives in the entity/validator; persistence in the repository; HTTP shaping in the Route Handler.
- **OCP:** add new payment methods by implementing a `PaymentProvider` interface, not by editing existing providers.
- **LSP:** prefer composition over inheritance; subtypes honor the base contract.
- **ISP:** granular interfaces (`IBookingRepository`, `IEmailSender`, `IStorage`) — no class implements methods it doesn't use.
- **DIP:** high-level services depend on abstractions; inject `PrismaClient`, `MercadoPagoClient`, `IEmailSender` via constructor.

```typescript
// ✅ DIP: BookingService depends on abstractions, not concretes
export class BookingService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly emailSender: IEmailSender,
  ) {}
}
```

- **DRY:** a single authoritative representation of each rule (e.g., deposit computation lives only in `DepositPolicy`, reused by the booking flow and the stats module).

---

## Coding Standards

### Naming Conventions
- **Variables & functions:** `camelCase` (`bookingId`, `findBookingById`).
- **Classes, interfaces, types:** `PascalCase` (`Booking`, `IBookingRepository`).
- **Constants:** `UPPER_SNAKE_CASE`.
- **Files:** `PascalCase.ts` for classes, `kebab-case.ts` for modules, `route.ts`/`actions.ts` per Next.js conventions.
- **Language:** all identifiers, comments, and error messages in **English** (user-facing strings are separate — see `frontend-standards.md`).

### Strong Typing
- `strict: true` in `tsconfig.json`. Explicit parameter and return types on public functions. Avoid `any`.
- Validate all external input with **Zod** at the presentation/application boundary; infer types from the schema.

### Error Handling
- Domain-specific error classes (`NotFoundError`, `SlotUnavailableError`, `InvalidBookingTransitionError`, `PaymentError`).
- A shared error-to-HTTP mapper produces the consistent envelope below.

```typescript
export class SlotUnavailableError extends Error {
  constructor(message = 'The selected time slot is no longer available') {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}
```

### Validation Patterns
- Validate all external inputs (request bodies, query params, action args, webhook payloads) before business logic runs.
- Centralize schemas under `src/server/application/<feature>/` — one folder per feature (`auth/loginSchema.ts`, `locations/locationSchema.ts`), colocated with that feature's other application-layer policy modules. A single flat `validators/` folder was the original convention; the feature-folder layout replaced it because it keeps a feature's schema next to the rules that use it as the tree grows.

### Logging Standards
- Use a centralized logger (structured JSON), not scattered `console.log`. Include context (bookingId, barberId, operation). Levels: `debug`, `info`, `warn`, `error`.

---

## API Design Standards

### Route Handlers (REST-ish)

URLs represent resources; HTTP methods express intent. Implemented as `app/api/<resource>/route.ts`.

```
GET    /api/bookings            # List (dashboard, authenticated)
POST   /api/bookings            # Create a provisional booking (public flow)
GET    /api/bookings/:id        # Retrieve
PATCH  /api/bookings/:id        # Update (e.g., cancel)
POST   /api/webhooks/mercadopago # Mercado Pago payment notifications
```

> Prefer **Server Actions** for dashboard mutations invoked from the app's own UI, and **Route Handlers** for public/unauthenticated endpoints and third-party webhooks (Mercado Pago).

**The public booking flow (B1–B6) MUST use Route Handlers for its mutations — this is a hard rule, not a preference.** Server Actions are addressed by an id that Next.js derives from a build-time key; a Route Handler is addressed by a URL that never changes. If that key is ever lost, rotated, or an action is renamed, every browser tab still open is left calling an id the server no longer knows, and the user gets a dead-end error. A guest halfway through paying a deposit is exactly the person who must never meet that failure. The dashboard, where the owner can simply reload, accepts the trade-off in exchange for the better ergonomics.

See `docs/s0-versions-decision.md` (finding 9) for the measurements behind this and `docs/tech-debt.md` for the client-side safety net that covers the remaining cases.

### Request / Response Envelope

```json
// Success
{ "success": true, "data": { }, "message": "Operation completed successfully" }
// Error
{ "success": false, "error": { "message": "...", "code": "ERROR_CODE" } }
```

### Error Response Format

| HTTP Status | Error Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Input failed validation |
| 401 | `UNAUTHORIZED` | Authentication required (dashboard) |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | State conflict (e.g., slot already taken) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### CORS
The public booking flow is served from the same origin as the API, so cross-origin access is not required. Do not enable permissive CORS. The only external caller is the Mercado Pago webhook, which is authenticated by signature validation, not CORS.

---

## Database Patterns

### Schema Definition
- `prisma/schema.prisma` is the single source of truth. Define relationships and referential integrity explicitly (see `data-model.md`). Use enums for status fields.

### Migrations
- All schema changes are version-controlled via Prisma migrations. Descriptive names. Review before applying to production.

```bash
npx prisma migrate dev --name add_booking_hold_expiry   # development
npx prisma migrate deploy                                # production
npx prisma generate                                      # regenerate client (driver-adapter build)
```

### Prisma on Cloudflare (driver adapters)
- Instantiate Prisma with the pg driver adapter pointed at the **Supabase Supavisor pooler** URL. Reuse a single client per Worker invocation context.

```typescript
// src/server/infrastructure/prisma/client.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString }); // Supavisor pooler URL
  return new PrismaClient({ adapter });
}
```

### Repository Pattern
- Domain defines interfaces; infrastructure implements them with Prisma; the client is injected via constructor.

---

## Booking & Payment Domain Rules

> ✅ These are the core invariants of this project. Enforce them in the domain/application layers, backed by DB constraints — never in the UI alone.

1. **No double-booking (concurrency-safe):** creating or confirming a booking must run inside a **database transaction** that re-checks for overlapping bookings in a blocking status (`PENDING_PAYMENT`, `PENDING_APPROVAL`, `CONFIRMED`) for the same barber before inserting. Use `SELECT ... FOR UPDATE` semantics (Prisma `$transaction` with a serializable/locking read) or a DB exclusion/unique constraint on `(barberId, startTime)`. Application-level read-then-write alone is insufficient.
2. **Provisional hold:** a new booking is created as `PENDING_PAYMENT` and sets `holdExpiresAt`. A scheduled job (Cloudflare Cron Trigger) expires stale holds → `EXPIRED`, releasing the slot.
3. **Mercado Pago confirmation:** the `/api/webhooks/mercadopago` handler validates the signature, looks up the payment by `mpPaymentId`, and on approval transitions Payment → `APPROVED` and Booking → `CONFIRMED`, then emits `BookingConfirmed`. Webhook handling is **idempotent** (safe to receive duplicates).
4. **Transfer approval:** uploading a receipt moves Booking → `PENDING_APPROVAL` (slot still held). Owner approval → Payment `APPROVED`, Booking `CONFIRMED`. Owner rejection → Payment `REJECTED`, Booking `CANCELLED`/`EXPIRED`, slot released.
5. **Deposit computation:** `depositAmount` is derived once from `PaymentConfig` (`FIXED` or `PERCENT` of `priceAtBooking`) at booking creation and snapshotted on the booking.
6. **Service bookability:** the booking flow must reject a service that has no active assigned barber (no `BarberService` row).
7. **Availability:** `startTime` must fall inside the barber's `WorkingHours` for that weekday and outside any `TimeOff`.

---

## Testing Standards

### Structure & Coverage
- File names `*.test.ts`, alongside source. **90% coverage** on domain + application layers.
- Test runner: **Vitest**.

### Organization — AAA
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('BookingService - createBooking', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should_reject_when_slot_overlaps_existing_confirmed_booking', async () => {
    // Arrange: mock repository returns an overlapping booking
    // Act: call service.createBooking(...)
    // Assert: expect SlotUnavailableError
  });
});
```

### Mocking
- Mock external dependencies (Prisma repositories, Mercado Pago, Supabase Storage, email).
- Mock repositories in service tests; mock services in Route Handler/action tests.
- Clear mocks before each test.

### Coverage per function
Happy path · error handling · edge cases (boundary slot times, DST) · validation (business rules) · integration points (DB, MP webhook).

### Anti-patterns to avoid
Testing implementation details; real DB in unit tests; order-dependent tests; skipping error/edge cases; hitting Mercado Pago in unit tests.

---

## Performance Best Practices

- **Query optimization:** select only needed fields; index frequently queried columns (`Booking.barberId + startTime`, `Booking.status`, `Client(ownerId, email)`); avoid N+1 with Prisma `include`/`select`.
- **Statistics:** compute dashboard aggregates with SQL `GROUP BY` / aggregate queries rather than loading rows into memory.
- **Async:** use `async/await`; `Promise.all` for independent operations; always handle errors.
- **Early returns** to reduce cognitive complexity.
- **Workers cold start:** keep server bundles lean; reuse the Prisma client; prefer the Supavisor pooler to avoid per-request connection overhead.

```typescript
// ✅ single query with eager loading
const booking = await db.booking.findUnique({
  where: { id },
  include: { client: true, barber: true, service: true, payments: true },
});
```

---

## Security Best Practices

### Input Validation
- Validate **all** external inputs with Zod before processing. Sanitize to prevent injection/XSS. File uploads (avatars, receipts) validated for type and size before storing in Supabase Storage.

### Secrets & Environment Variables
- Never commit secrets. Store them as Cloudflare/Wrangler secrets and `.dev.vars` locally (git-ignored). Validate presence at startup.
- **Mercado Pago Access Token** and the DB connection string are server-only; never sent to the browser. Only the MP **Public Key** is exposed to the client.
- Validate the Mercado Pago **webhook signature** on every notification.

```typescript
const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
required.forEach((v) => { if (!process.env[v]) throw new Error(`Missing required env var: ${v}`); });
```

### AuthN / AuthZ
- The dashboard is protected: only the authenticated **Owner** may access admin Route Handlers/actions. Enforce auth in middleware and re-check in each server action (never trust the client).
- Public booking endpoints are unauthenticated but rate-limited and strictly validated. Client cancellation is authorized by the unguessable `cancellationToken`, not by session.
- Encrypt `PaymentConfig.mpAccessToken` at rest.

### Dependency Injection
- Inject external dependencies (Prisma, MP client, storage, email) rather than instantiating inside classes. Avoid global mutable infrastructure state — enables testability and DIP.

---

## Development Workflow

### Git Workflow
- Short-lived feature branches with descriptive names. Commit messages in **English** (Conventional Commits). Small, focused PRs. Code review before merge to main.

### Development Scripts

| Purpose | Command |
|---|---|
| Start dev server | `npm run dev` |
| Build for production | `npm run build` |
| Preview on Workers runtime | `npm run preview` (opennextjs-cloudflare + wrangler) |
| Run tests | `npm test` |
| Run tests with coverage | `npm run test:coverage` |
| Generate Prisma client | `npx prisma generate` |
| Create & apply migration | `npx prisma migrate dev` |
| Seed database | `npx prisma db seed` |
| Lint / type-check | `npm run lint` / `npm run typecheck` |

### Code Quality
- Lint and type-check must be clean before commit. All tests pass before deployment. Coverage ≥ 90% on domain/application layers.

---

## Deployment

**Target platform: Cloudflare** (Workers/Pages) via **`@opennextjs/cloudflare`**.

- The Next.js app is built and adapted for the Cloudflare Workers runtime with OpenNext; deployed with **Wrangler**.
- Secrets (DB URL/Supavisor pooler, Supabase keys, Mercado Pago token, Resend key) are set as Wrangler secrets — never committed.
- **Database:** Supabase (managed); migrations applied with `prisma migrate deploy` in the release step.
- **Scheduled jobs:** use **Cloudflare Cron Triggers** to expire stale provisional holds and to send appointment reminders (if enabled later).
- **Storage:** Supabase Storage buckets for images and receipts (private bucket for receipts; signed URLs for access).

```jsonc
// package.json (illustrative scripts)
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
  }
}
```

> This document is the reference foundation for backend code quality and consistency in
> Reserva Barber. Preserve the architectural principles; keep every stack-specific detail
> aligned with `project-context.md` and `data-model.md`.
