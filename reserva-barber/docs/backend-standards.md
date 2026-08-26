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
  'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export class Booking {
  constructor(
    public readonly id: string,
    public readonly barberId: string,
    public readonly serviceId: string,
    public readonly clientId: string,
    public readonly startTime: Date,
    public readonly endTime: Date,
    public status: BookingStatus
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
  constructor(
    public readonly start: Date,
    public readonly end: Date
  ) {
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
    private readonly emailSender: IEmailSender
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

| HTTP Status | Error Code         | Meaning                                   |
| ----------- | ------------------ | ----------------------------------------- |
| 400         | `VALIDATION_ERROR` | Input failed validation                   |
| 401         | `UNAUTHORIZED`     | Authentication required (dashboard)       |
| 403         | `FORBIDDEN`        | Insufficient permissions                  |
| 404         | `NOT_FOUND`        | Resource does not exist                   |
| 409         | `CONFLICT`         | State conflict (e.g., slot already taken) |
| 500         | `INTERNAL_ERROR`   | Unexpected server error                   |

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
2. **Provisional hold:** a new booking is created as `PENDING_PAYMENT` and sets `holdExpiresAt`. A scheduled job (Cloudflare Cron Trigger, every five minutes) sweeps stale holds → `EXPIRED`.

   > **The sweep does not release the slot; it records that the slot was released.** Availability has stopped counting a lapsed hold since B3, by evaluating `holdExpiresAt` at read time through `blocksAvailability`. A swept row and an unswept lapsed row are indistinguishable to every read path. What the sweep adds is the terminal status, so a reader that filters on status alone — the shape a dashboard of counters naturally takes — is correct rather than accidentally correct.
   >
   > **A `PENDING_PAYMENT` row is eligible `EXPIRY_GRACE_MINUTES` (10) after `holdExpiresAt`, never at it.** The late-payment confirmation in rule 3 is guarded on the booking still being `PENDING_PAYMENT`; expiring the row the instant its hold lapsed would convert every approval that arrives just afterwards into an approved charge against a booking that no longer exists. The grace costs nothing, because the slot has been sellable throughout it.
   >
   > **The sweep takes no advisory lock, and every one of its writes is guarded on the status it expects.** Rule 1's lock exists so two writers cannot _place_ a booking into one slot; a sweep only ever releases, and a release cannot double-book. Safety comes from the conditional update instead: a booking that moved underneath the run (a receipt attached, a payment confirmed) matches zero rows rather than having `EXPIRED` stamped over it. That is also what makes the job idempotent and safe to overlap with itself.
   >
   > **It is bounded, and it is the product's only cross-owner write.** Candidates are selected in batches with a row limit and a per-run cap, because the first production run meets every abandoned hold ever created. SQL may only _narrow_ the candidate set — status, one instant bound, a limit — and `blocksAvailability` makes every eligibility decision, for the reason rule 1 gives: a second copy of a rule that reads a deadline drifts from the first. Because a sweep cannot be owner-scoped, it lives behind its own repository contract that names the exception, rather than widening a booking contract that states an unscoped query is inexpressible through it.

3. **Mercado Pago confirmation:** the `/api/webhooks/mercadopago` handler treats the notification body as a **hint, never as evidence**, and establishes authenticity by **re-fetching the payment from Mercado Pago** (`GET /v1/payments/{id}`) with the owner's own access token. That response is the sole authority. Before any transition it verifies three properties against the stored row — `external_reference` equals the booking id, `transaction_amount` equals the payment's recorded amount, and `currency_id` is `ARS` — and a mismatch refuses rather than confirms. On approval it transitions Payment → `APPROVED` and Booking → `CONFIRMED`. Webhook handling is **idempotent**, guaranteed by a unique `mpPaymentId` and a status-guarded conditional update rather than by a prior read. Every handled, ignored or refused notification answers `200`; only a genuinely transient failure answers `503`, because a retry is the only thing that can resolve it.

   > **A confirmed transition hands off to the confirmation email, after the transaction and never inside it.** The handoff is keyed on the **outcome of the guarded write**, never on the booking's observed status: this endpoint is public and redelivery is normal operation, so every duplicate notification re-reaches `CONFIRMED`, and a send keyed on the status would turn an unauthenticated endpoint into an unbounded mail sender aimed at one real person. Exactly one caller per booking ever observes the confirming outcome, which is what makes the email at-most-once without a second mechanism. **A send failure changes nothing** — not the booking, not the outcome, and not the `200`. It must not become a `503`: the retry that request asks for would find the booking already `CONFIRMED`, report it as already processed, and by the rule above send nothing, so the failure would erase its own evidence while spending an outbound call per delivery.

   > **Why not signature validation.** Mercado Pago's `x-signature` is an HMAC keyed by a **per-integration webhook secret** issued in their dashboard. This product is multi-tenant against Mercado Pago — every owner brings their own account — so choosing _which_ owner's secret to validate with requires resolving the notification first, and no such secret is stored. The owner is instead resolved from a `ref` query parameter on the `notification_url` carrying the `Payment` row's id, which is not a secret and authorizes nothing. **The re-fetch is the stronger check**: a signature proves only that Mercado Pago sent the bytes, while the re-fetch proves the payment exists, is approved, is for the right amount and is bound to our booking. Storing a webhook secret is deferred as **T60**. A `validateSignature()` that passes when no secret is configured must never be introduced — it reads as protection in every later review while protecting nothing. (Decided in B5 design D1.)

4. **Transfer deposit and approval:** committing to a bank transfer opens a `BANK_TRANSFER` `Payment` and **extends the hold** to `TRANSFER_HOLD_DURATION_MINUTES`, under the shared clamp — the destination is not disclosed before that write, so a client never transfers into a window about to lapse. Uploading a receipt moves Booking → `PENDING_APPROVAL` (slot still held). Owner approval → Payment `APPROVED`, Booking `CONFIRMED`. Owner rejection → Payment `REJECTED`, Booking `CANCELLED`, slot released.

   > **All three writes take the per-barber advisory lock and guard their update.** The receipt write, the approval and the rejection each run in one transaction whose first statement takes the same lock the booking write takes, and each booking update is **conditional on the status it expects** so a concurrent transition matches zero rows instead of being reasserted. B4 recorded that "an advisory lock binds only code that takes it" and named the transfer approval as a future caller; these are it. The lock is acquired with a statement executed for its effect, never a query reading a column back — `pg_advisory_xact_lock` returns `void`, which the driver adapter cannot deserialize, and a test that mocks the query call cannot tell the difference (B4, T58).
   >
   > **`PENDING_APPROVAL` is not resolved by time, with one exception.** `holdExpiresAt` is the deadline for uploading a receipt, not for answering one, so the sweeper must not expire this status on it. A `PENDING_APPROVAL` booking whose **`startTime` has passed** is the exception and is eligible for expiry: its slot is unsellable regardless, and without this the status has no exit that does not depend on the owner being attentive. **The sweep in rule 2 is the job that acts on this exception**, and it is the only one — the grace window does not apply here, because the grace protects an in-flight gateway confirmation and this path has no gateway.
   >
   > **An applied approval hands off to the same confirmation email, under the same rules.** After the transaction, never inside it; keyed on the approval having been *applied*, so an approval that matched zero rows sends nothing; and non-fatal, so the receipt, the payment and the booking stay approved and confirmed when the provider is down. **This is the path where the email matters most**: the Mercado Pago client is at least looking at a page when their booking confirms, while a transfer client is told a human will decide and then learns the answer only if something reaches them. Correspondingly, the owner's success message MUST NOT claim the client was notified unless the send was recorded — telling an owner that a client has been informed when they have not removes the owner's reason to make contact by hand, which is the only recovery this product offers.

   > **Nothing here verifies that money moved.** There is no gateway on this path. The receipt is evidence for a human, the review surface renders the snapshotted deposit beside it, and no code may treat an uploaded file as proof of payment.

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  > **A dashboard's figures are ONE owner-scoped statement, not one query per figure.** Six counters are six round trips, and a round trip to Supavisor costs ~0.35–0.40 s from this deployment (`docs/tech-debt.md`) — but latency is the lesser reason. **Six queries answer from six different instants**, so a booking confirmed mid-render is counted by one figure and not by another, and the owner is shown two numbers that cannot both be true. One statement makes the set a snapshot. (D1.)
  >
  > **Scope reaches the owner through `barber → location → ownerId`.** A booking's location is deliberately not duplicated onto the row (`data-model.md` §11), so this is the only path. There is no row-level security on these tables: the join **is** the tenancy boundary, and an aggregate is the worst place to forget it because a leaked figure produces no row that can look wrong — only a plausible integer. Cross-owner isolation on an aggregate is therefore proven by a **two-owner fixture**, never by inspection.
  >
  > **An aggregate may narrow; it may not decide.** A reporting statement may filter by status, by owner and by an instant range. It SHALL NOT re-express a rule that reads a hold deadline — `blocksAvailability` remains the only definition of whether a booking still holds its slot, for the reason the booking write and the sweep both record: a second copy drifts from the first the moment either is refined.
  >
  > **A monetary aggregate crosses the repository boundary as a canonical decimal string**, exactly as every individual money column does. The driver returns a stored `2000.50` as `2000.5` and integer-cent arithmetic then reads the lone `5` as five centavos (measured in PC3). A `SUM` carries the same defect, and every test that mocks the repository passes while it is present. An empty aggregate is normalized to a canonical zero rather than surfaced as null, so no caller has to decide what a missing sum means.
  >
  > **Income joins through the booking's status.** See the Booking & Payment Domain Rules — an `APPROVED` payment may belong to a booking that never confirmed, and summing payments alone reports a refund the owner owes as revenue they earned.

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
- **Type is decided by the file's leading bytes, never by its declared content type or its extension.** Both are client-controlled and prove nothing. The declared type is what a bucket's `allowed_mime_types` checks, so it is a third layer and never the first.
- **A client-supplied filename never contributes to a storage key.** Storage keys accept path separators, so a filename reaching a key is a traversal primitive. Keys are composed entirely of server-held values.
- **A size ceiling is enforced three times:** refused on `Content-Length` before the body is read, re-checked against the actual byte length because that header is client-controlled, and enforced again by the bucket's own `file_size_limit`. A multipart body is buffered in a `workerd` isolate with a hard memory bound, so the first check is a memory guard and not a formality.

#### Uploads from an anonymous writer

Transfer receipts (B6) are the only upload in this product whose author has **no session**, and that breaks the guarantee every other write relies on. P1's rule — a write outside the owner's own prefix is refused by the **database**, because the bucket policy compares the key's leading segment against `auth.uid()` — cannot be expressed for a caller who has no `auth.uid()`.

- **An anonymous write is admitted only through a database predicate, never by a bare grant.** The insert policy calls a `SECURITY DEFINER` function with a pinned `search_path` that resolves the object key against the application's own tables: the key must name a real booking, in a live hold, under that booking's real owner. `SECURITY DEFINER` is what lets the check read those tables without granting the anonymous role any privilege on them.
- **An unconditional `anon` insert policy must never be introduced.** The key that would authorize it is designed to be published — the first story that adds a browser-side Supabase client exposes it correctly and silently makes the bucket world-writable. A policy that admits every caller reads as protection in every later review while protecting nothing, which is the same objection that rejected a no-op `validateSignature()` in B5.
- **The bucket is private, and the anonymous role gets no `select`, `update` or `delete`.** The owner reads through a short-lived signed URL created with their own session and forced to download, so a PDF carrying active content is never executed against the storage origin.
- **These objects live in a schema the ORM does not track.** A rename in the application's tables breaks the predicate and is never reported as drift, so the SQL names the columns it depends on in comments and a runtime gate probe exercises the refusal path.

### Secrets & Environment Variables

- Never commit secrets. Store them as Cloudflare/Wrangler secrets and `.dev.vars` locally (git-ignored). Validate presence at startup.
- **Mercado Pago Access Token** and the DB connection string are server-only; never sent to the browser. Only the MP **Public Key** is exposed to the client.
- Validate the Mercado Pago **webhook signature** on every notification.

**Global validation is for variables without which nothing works.** `RESEND_API_KEY` and
`PAYMENT_CREDENTIALS_KEY` are **not** among them and MUST NOT be added to this list — see the rule
below. A deploy missing either must break one feature, not every page.

```typescript
const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
required.forEach((v) => {
  if (!process.env[v]) throw new Error(`Missing required env var: ${v}`);
});
```

- **A per-feature secret is validated at that feature's composition root**, never here. This covers
  `PAYMENT_CREDENTIALS_KEY` (payment credentials) and `RESEND_API_KEY` (confirmation email). Without
  the email key, bookings still confirm, the missing variable is named in the log, and no page,
  endpoint or dashboard action fails.
- **A secret is set only where it is used.** `RESEND_API_KEY` belongs on the application Worker and
  not on the scheduled one, which sends nothing: a secret placed where it is not needed is a second
  place to remember when rotating it.
- **A non-secret deployment value belongs in committed `wrangler.jsonc` `vars`**, not in the
  Cloudflare dashboard — `APP_ORIGIN` and `EMAIL_FROM` both. A value kept only in the dashboard is a
  value the next deploy from a fresh clone silently lacks.
- **`APP_ORIGIN`'s absence is no longer only cosmetic.** It used to degrade social-preview tags with
  no error and no log. It now also removes the link from every confirmation email, which is most of
  the reason the email exists, so any path composing an outbound link logs an error when no origin
  resolves. An outbound link is built from configuration alone: no request header may contribute to
  it, and no loopback or relative URL may be emitted into a message that cannot be recalled.

### Encrypting a stored secret

> Established by PC2, the first value this application encrypts itself. Follow it for any future one.

- **AES-256-GCM via Web Crypto** (`crypto.subtle`), not `node:crypto`. Web Crypto is the first-class
  API on `workerd`; the modules that protect secrets should not depend on a compatibility shim.
- **A versioned, self-describing envelope** — `v1.<base64url iv>.<base64url ciphertext‖tag>` — from
  the first stored value, so a later key or algorithm change can identify what it is reading. A value
  that does not parse is **rejected**; never fall back to treating it as plaintext.
- **A fresh random 96-bit IV per encryption.** Never derived, never counter-based. Reuse under AES-GCM
  breaks confidentiality _and_ authenticity, and it is invisible in every test except one that asserts
  two encryptions of the same plaintext differ. Write that test.
- **Bind the owner id and a purpose string as additional authenticated data**, so a ciphertext lifted
  from another row or another context fails to authenticate instead of decrypting into the wrong place.
- **Encrypt and decrypt at the persistence boundary**, alongside the other conversions there. Layers
  above exchange plaintext and stay unaware encryption exists — a layer that handles envelopes is a
  layer that can log one or forget to decrypt one.
- **Distinguish a missing key from an unreadable value.** A configuration fault and a data fault lead
  to different advice for the user; collapsing them tells an owner to re-enter credentials that are fine.
- **Validate the key at the composition root of the feature that uses it**, never in `validateEnv()`.
  A missing secret must break one page, not the whole dashboard.
- **Surface an undecryptable value as its own state** in the UI, distinct from "not configured".
  Otherwise the failure is discovered by a user action far from its cause.

### Calling an external service

> Established by B5's Mercado Pago gateway and followed by N1's email sender. Follow it for any future one.

- **The platform `fetch`, and no vendor SDK.** A handful of endpoints does not justify a package
  against a Worker bundle already near its size ceiling (`tech-debt.md` T51). Both integrations in
  this product are two endpoints and one endpoint respectively, and both are hand-rolled.
- **An injected `fetch`-shaped transport** (`constructor(private readonly transport: typeof fetch = fetch)`),
  so tests never reach the network and the timeout behaviour is provable rather than assumed.
- **Every call bounded by an abort timeout.** An unbounded call leaves a request pending until the
  platform kills it, after which the client submits again and two writes race.
- **The credential in a header, never in a URL or a query string.**
- **No response body ever leaves the adapter** — not to a log, not attached to an error, not on a
  returned value. This is not fastidiousness: Mercado Pago's rejection payloads echo the credential
  they rejected, and an email provider's `422` echoes the recipient address and whatever link the
  message carried. A body that reaches a log is a leaked secret in both cases.
- **No external call inside a database transaction.** A third party's latency must never hold a
  pooled connection the owner's dashboard is also waiting on. The structural form of this rule is
  that the adapter imports nothing from the database layer.
- **A failure that must not be fatal is returned as a value, never thrown.** Where a caller sits on a
  path whose failure semantics are already decided — a webhook that answers `200` to everything
  handled, an owner action that already committed — the port returns a small closed set of outcomes
  and the adapter catches its own transport errors and its own abort. A `throw` there would reach the
  route's `catch`, become a `503`, and ask the third party to redeliver work that already succeeded.
  Making the failure a value makes that shape unreachable rather than merely avoided by a `try`
  somebody could later remove.
- **The outcome set distinguishes what leads to different action.** At minimum: accepted · refused
  for a reason a retry cannot change · rate-limited or quota-exhausted · transient. Collapsing the
  third into the second hides the failure an operator most needs to see.

### AuthN / AuthZ

- The dashboard is protected: only the authenticated **Owner** may access admin Route Handlers/actions. Enforce auth in middleware and re-check in each server action (never trust the client).
- Public booking endpoints are unauthenticated but rate-limited and strictly validated. Client cancellation is authorized by the unguessable `cancellationToken`, not by session.
- Encrypt `PaymentConfig.mpAccessToken` at rest.
- **The route guard's public set is named, never inferred.** `middleware.ts` is deny-by-default: it permits an explicit, small set of paths and protects everything else, so a route added tomorrow is protected the moment it exists. Public booking write endpoints (`POST /api/bookings`, and later the Mercado Pago webhook) join this set as **exact path matches**, never a prefix — opening `/api` as a prefix would admit every future endpoint the moment it is created, including the dashboard's own. Each addition is asserted by an executable guard test, because neither an owner's normal use of the dashboard nor a guest's normal use of the public flow would ever surface a misconfigured entry.
- **Public writes are bounded per client identity, not only rate-limited by request.** A public write endpoint (the booking hold is the first) SHALL cap concurrent uncompleted state per the identity the write itself establishes (e.g., client email within an owner) in addition to any per-origin throttle. A per-origin throttle alone is insufficient on a runtime with no request counter shared across isolates — it blunts a naive loop and does not defeat a distributed one, and SHOULD be documented as best-effort where that is true. The bound checked against the database is the one that holds.

### Dependency Injection

- Inject external dependencies (Prisma, MP client, storage, email) rather than instantiating inside classes. Avoid global mutable infrastructure state — enables testability and DIP.

---

## Development Workflow

### Git Workflow

- Short-lived feature branches with descriptive names. Commit messages in **English** (Conventional Commits). Small, focused PRs. Code review before merge to main.

### Development Scripts

| Purpose                    | Command                                              |
| -------------------------- | ---------------------------------------------------- |
| Start dev server           | `npm run dev`                                        |
| Build for production       | `npm run build`                                      |
| Preview on Workers runtime | `npm run preview` (opennextjs-cloudflare + wrangler) |
| Run tests                  | `npm test`                                           |
| Run tests with coverage    | `npm run test:coverage`                              |
| Generate Prisma client     | `npx prisma generate`                                |
| Create & apply migration   | `npx prisma migrate dev`                             |
| Seed database              | `npx prisma db seed`                                 |
| Lint / type-check          | `npm run lint` / `npm run typecheck`                 |

### Code Quality

- Lint and type-check must be clean before commit. All tests pass before deployment. Coverage ≥ 90% on domain/application layers.

---

## Deployment

**Target platform: Cloudflare** (Workers/Pages) via **`@opennextjs/cloudflare`**.

- The Next.js app is built and adapted for the Cloudflare Workers runtime with OpenNext; deployed with **Wrangler**.
- Secrets (DB URL/Supavisor pooler, Supabase keys, Mercado Pago token, Resend key) are set as Wrangler secrets — never committed.
- **Database:** Supabase (managed); migrations applied with `prisma migrate deploy` in the release step.
- **Scheduled jobs:** use **Cloudflare Cron Triggers** to expire stale provisional holds and to send appointment reminders (if enabled later).

  > **A scheduled job is its own Worker, never a handler bolted onto the application's.** OpenNext emits `.open-next/worker.js` exporting `fetch` and its Durable Object classes and nothing else, and rewrites it on every build, so a `scheduled()` handler can only be added by a committed entrypoint that wraps it. B7 built exactly that, and abandoned it on a measurement: the wrapper itself cost **0.15 KiB**, but **anything it imports from `src/` is compiled by wrangler's own esbuild pass, separately from the copy already inside `.open-next/server-functions/default/handler.mjs`** — so the Prisma query compiler shipped twice and the bundle went from 2924 to 3812 KiB gzip, past the free plan's 3 MiB ceiling.
  >
  > **The rule that generalizes: a custom entrypoint must not import application code that reaches Prisma.** A separate Worker (`wrangler.cron.jsonc`, `worker/sweep.ts`) makes the duplication moot, needs no Next.js build, and — exporting no `fetch` handler at all — is the cheapest possible answer to "can a stranger reach this job". The alternative, an `/api/cron/…` route invoked over `fetch`, was rejected: it keeps one deploy at the cost of a door in a deny-by-default guard plus a shared secret to defend it.
  >
  > **A scheduled invocation is not a request, and code reached from one must be written for that.** There is no request context: bindings arrive as the invocation's `env` argument, `process.env` is not populated, and a request-scoped memo (`react`'s `cache()`) has no store to live in. `getPrismaClient()` satisfies none of those conditions — the scheduled path builds its own client from `env.DATABASE_URL` and reports its absence by name.
  >
  > **This failure is silent by nature**, which is why it is a standard rather than a note: a scheduled job written against request-time assumptions leaves every page working and simply never does anything. Every scheduled handler emits one structured summary per run, **including runs that did no work**, so that "the job is dead" is distinguishable from "the job had nothing to do". No unit test executes the entrypoint, so it is fired by hand against the local runtime before it is deployed — through a **committed script** (`npm run preview:cron`), because `--test-scheduled` is what creates the `/__scheduled` endpoint and forgetting it does not produce an error: the URL becomes an ordinary path, the route guard redirects it, and the request answers `200` with a page while no handler runs.

- **Storage:** Supabase Storage buckets for images and receipts (private bucket for receipts; signed URLs for access).

```jsonc
// package.json (illustrative scripts)
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
  },
}
```

> This document is the reference foundation for backend code quality and consistency in
> Reserva Barber. Preserve the architectural principles; keep every stack-specific detail
> aligned with `project-context.md` and `data-model.md`.
