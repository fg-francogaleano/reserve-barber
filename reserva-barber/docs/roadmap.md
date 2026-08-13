# Roadmap
## Reserva Barber — dependency-aware user story backlog

> Derived from `base-standards.md` (Core Features) and `data-model.md` (entities).
> Prioritization: **walking skeleton first, then MoSCoW per phase**. Within a phase,
> stories never appear before their dependencies. Story IDs (`S0`, `A1`, `M2`…) exist
> only for cross-referencing dependencies inside this file.

---

## Phase 0 — Walking Skeleton

The thinnest end-to-end slice touching every layer: repo scaffold, DB, one entity, one server read, one screen, deployed to Cloudflare. Validates the riskiest architectural assumption (Next.js + Prisma driver adapters + Supavisor on `workerd`) before any real feature is built.

- [x] **S0** — As the owner, I want to see a list of my locations (seeded in the database) rendered on the deployed app, so that the full stack (Next.js on Cloudflare → Prisma/Supavisor → Supabase Postgres) is proven to work end to end. — *depends on: none*
  - Includes: project scaffold (Next.js, TypeScript strict, Tailwind, shadcn/ui, ESLint/Prettier, Vitest), Prisma schema with the `Location` model only, Supabase project + migration, `@opennextjs/cloudflare` deploy pipeline with Wrangler secrets, layered folder structure (`src/server/domain|application|infrastructure`).

---

## Phase 1 — Must-Have

Everything required for a minimally usable product: the owner can set up the business, a guest can book and pay a deposit, and the owner can see and manage the resulting bookings.

### 1a. Foundation

- [x] **A1** — As the owner, I want to log in and log out of a protected dashboard, so that only I can administer the business. — *depends on: S0*
- [x] **M1** — As the owner, I want to create and edit my locations, so that each branch of my business can receive bookings. — *depends on: A1*
- [x] **M2** — As the owner, I want to register barbers and assign each one to a location, so that clients can book with them. — *depends on: M1*
- [x] **M3** — As the owner, I want to create services with a price and a duration, so that clients know what they can book and slots can be sized correctly. — *depends on: A1*
- [x] **M4** — As the owner, I want to assign services to barbers, so that a service becomes available in the booking flow (a service with no assigned barber must not be bookable). — *depends on: M2, M3*
- [x] **M5a** — As the owner, I want to define each barber's weekly working hours, so that available slots reflect when they actually work. — *depends on: M2*
- [x] **M5b** — As the owner, I want to register each barber's days off and absences, so that available slots exclude the days they are away. — *depends on: M2; independent of M5a*
  - M5 was split during refinement: the two are different entities with different write shapes — a whole-week replacement versus row-level create and delete — and they share nothing but the story that consumes them. B3 depends on both; they can be built in either order or in parallel.

### 1b. Public presence & payment setup

- [x] **P1** — As the owner, I want to edit my public profile (business name, bio, profile/cover images, social links) and get my shareable booking link, so that clients see my brand when they open it. — *depends on: A1; images require Supabase Storage setup*
  - Carried the Supabase Storage setup, as planned: a public bucket whose write policy confines the authenticated role to its own `auth.uid()` prefix, proven from both sides against real infrastructure. No new secret — the upload runs as the owner's own session, never a service role.
  - The shareable link is rendered and disclosed as not yet published. It resolves to `/b/{slug}`, which redirects to `/login` until **B1** ships the public page.
- [ ] **PC1** — As the owner, I want to save my bank transfer details (CBU/CVU or alias, holder name), so that clients can pay the deposit by transfer. — *depends on: A1*
- [ ] **PC2** — As the owner, I want to save my Mercado Pago credentials (Access Token, Public Key), so that clients can pay the deposit online. — *depends on: A1*
- [ ] **PC3** — As the owner, I want to configure the deposit policy (fixed amount or percentage of the service price), so that every booking charges the right deposit. — *depends on: PC1 or PC2 (at least one payment method configured)*

### 1c. Public booking flow

- [ ] **B1** — As a client, I want to open the shared link and see the barbershop's public profile with a "Reservar" button, so that I can start a booking. — *depends on: P1*
- [ ] **B2** — As a client, I want to choose a location, then a service, then a barber of that location who performs it, so that my booking matches how the business operates. — *depends on: B1, M4*
- [ ] **B3** — As a client, I want to pick a date and see the barber's truly available time slots (working hours − time off − existing bookings, sized by service duration), so that I can choose a valid time. — *depends on: B2, M5a, M5b*
- [ ] **B4** — As a client, I want to enter my name, email and phone and create a provisional booking that holds my slot, so that nobody else can take it while I pay. — *depends on: B3*
  - Includes: `Client` dedup by (owner, email), transactional no-overlap check, `PENDING_PAYMENT` status, `holdExpiresAt`, `cancellationToken` generation.
- [ ] **B5** — As a client, I want to pay the deposit with Mercado Pago and have my booking confirmed automatically, so that my appointment is guaranteed without manual steps. — *depends on: B4, PC2, PC3*
  - Includes: preference creation, redirect/checkout, idempotent webhook with signature validation, Payment `APPROVED` → Booking `CONFIRMED`.
- [ ] **B6** — As a client, I want to pay the deposit by bank transfer and upload the receipt, so that my booking is held while the owner verifies it. — *depends on: B4, PC1, PC3*
  - Includes: show CBU/CVU/alias, receipt upload to private Supabase Storage bucket, Booking → `PENDING_APPROVAL`.
- [ ] **B7** — As the owner, I want provisional bookings that were never paid to expire automatically and release their slot, so that abandoned checkouts don't block my agenda. — *depends on: B4; Cloudflare Cron Trigger*

### 1d. Booking administration

- [ ] **D1** — As the owner, I want a dashboard home with today's bookings, today's cancellations, total bookings, pending transfer receipts, current-month income, and a recent-bookings list filterable by barber, so that I see the state of my business at a glance. — *depends on: B4 (bookings exist); counters for receipts/income complete with B5, B6, D2*
- [ ] **D2** — As the owner, I want to review pending transfer receipts and approve or reject them, so that transfer bookings get confirmed (approve → `CONFIRMED`) or their slot released (reject). — *depends on: B6*
- [ ] **N1** — As a client, I want to receive a confirmation email when my booking is confirmed, including a cancellation link, so that I have proof and control of my appointment. — *depends on: B5 or B6+D2 (a booking can reach `CONFIRMED`); Resend integration*
- [ ] **C1** — As a client, I want to cancel my booking from the tokenized link in my email, so that I can free the slot without contacting the shop. — *depends on: N1*
- [ ] **C2** — As the owner, I want to cancel any booking from the dashboard, so that I can handle no-shows and schedule changes. — *depends on: D1*

---

## Phase 2 — Should-Have

Meaningfully improves daily operation, but launch is possible without it.

- [ ] **D3** — As the owner, I want a card per barber that opens that barber's calendar with all their appointments, so that I can visualize each schedule day by day. — *depends on: B4, C2*
- [ ] **D4** — As the owner, I want a clients table (name, phone, email, number of bookings), so that I know my customer base. — *depends on: B4*
- [ ] **D5** — As the owner, I want statistics with time-range filters (today, yesterday, this week…) showing totals (bookings, income, cancellations, average per booking, unique clients), so that I can measure business performance. — *depends on: B5, B6, C1/C2 (needs confirmed and cancelled bookings to be meaningful)*
- [ ] **D6** — As the owner, I want income-evolution and payment-methods charts, so that I can spot trends visually. — *depends on: D5*

---

## Phase 3 — Could-Have

Deferred without regret if time runs out.

- [ ] **D7** — As the owner, I want advanced statistics (most popular services, most active barber, hourly distribution of bookings), so that I can optimize staffing and offerings. — *depends on: D5*
- [ ] **N2** — As a client, I want a reminder email before my appointment, so that I don't forget it. — *depends on: N1, B7 (reuses the Cron Trigger)*
- [ ] **D8** — As the owner, I want the pending-receipts counter to update live while I work, so that I don't need to refresh the dashboard. — *depends on: D2 (TanStack Query polling)*
- [ ] **M6** — As the owner, I want to deactivate barbers, services, or locations without deleting them, so that history and statistics stay intact. — *depends on: M2, M3 (the `isActive` flags exist from Phase 1; this story is the management UI for them)*

---

## Dependency Notes

- **The walking skeleton (S0) de-risks the deploy stack.** Prisma driver adapters + Supavisor on Cloudflare's `workerd` runtime is the single most fragile assumption in the architecture (`backend-standards.md` → Database Patterns). If S0 fails, the stack decision must be revisited *before* any feature work — that is why S0 ships a real DB read, not a static page.
- **M4 is the gate to the booking flow, not M3.** A service alone is not bookable; `data-model.md`'s availability rule requires a `BarberService` row with an active barber. B2 therefore depends on M4, never directly on M3.
- **PC3 (deposit policy) blocks both payment stories.** B5 and B6 compute `depositAmount` from `PaymentConfig` at booking creation; deposit configuration is not optional polish, it is upstream of any payment.
- **B4 is the concurrency-critical story.** The transactional no-overlap rule and the provisional hold (`backend-standards.md` → Booking & Payment Domain Rules #1–2) live here. B5, B6, B7, and D2 all assume holds work correctly — do not start them until B4's transaction is tested under concurrent requests.
- **N1 sits behind *either* payment path, and C1 sits behind N1.** The cancellation link travels in the confirmation email, so client cancellation cannot ship before email sending works — even though the cancel endpoint itself only needs the token from B4.
- **D1's counters complete incrementally.** The dashboard home can ship after B4 with booking counts only; the "pending receipts" and "income" cards become meaningful once B6/D2 and B5 land. This is acceptable — do not block D1 on the full payment suite.
- **Infrastructure stories hide inside feature stories.** Supabase Storage setup rides with P1 (first image upload), Resend with N1 (first email), the Cron Trigger with B7 (first scheduled job). If these integrations are set up earlier for convenience, the dependent stories still own their end-to-end verification.
