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
  - The shareable link is rendered, and was disclosed as not yet published — it resolved to `/b/{slug}`, which redirected to `/login`. **B1 has since opened that route and removed the disclosure.**
- [x] **PC1** — As the owner, I want to save my bank transfer details (CBU/CVU or alias, holder name), so that clients can pay the deposit by transfer. — *depends on: A1*
- [x] **PC2** — As the owner, I want to save my Mercado Pago credentials (Access Token, Public Key), so that clients can pay the deposit online. — *depends on: A1*
  - Carried the project's first credential encryption: AES-256-GCM over Web Crypto, a versioned `v1.<iv>.<ciphertext>` envelope, a fresh IV per write, and the owner plus a purpose bound as additional authenticated data. New Wrangler secret `PAYMENT_CREDENTIALS_KEY`, validated at this feature's composition root rather than globally, so a deploy that forgets it breaks one page instead of the dashboard. No migration — PC1 created both columns.
  - The access token is write-only: an empty field means *unchanged*, removal is an explicit intent, and the token never reaches the browser in any state, including the confirmation.
  - Credentials are verified against Mercado Pago before storage. A definitive rejection blocks the write; an unreachable Mercado Pago saves anyway and says so, because refusing to save when a third party is down would be this feature failing for a reason unrelated to the owner's input.
  - The confirmation names the Mercado Pago **account**, and states prominently when a replacement switches accounts — the account id comes out of the token offline, so that warning holds even when Mercado Pago cannot be reached. It is the only thing separating a routine rotation from redirecting every future deposit.
  - The page has four states, not three: credentials that cannot be decrypted are their own, because a presence flag alone would render a healthy-looking page over an unusable token and leave B5 to discover it in a real payment.
- [x] **PC3** — As the owner, I want to configure the deposit policy (fixed amount or percentage of the service price), so that every booking charges the right deposit. — *depends on: PC1 or PC2 (at least one payment method configured)*
  - The first payment story with **no external authority to lean on**. PC1 had a checksum, PC2 had Mercado Pago itself; a deposit is a number the owner invents, and `30` and `3` are both valid. Every safeguard here is built from what the system already knows — the owner's own service prices, and the policy being replaced.
  - Carried the project's only deposit calculation, as a `DepositPolicy` value object that B4, B5 and B6 consume and none of them reimplements. The rule is **ordered**: percentage or fixed, rounded half-up over integer cents, capped at the service price, then floored at a minimum — with the floor *guarded*, so it cannot undo the cap for a service priced below it and charge more than the service costs.
  - **The cap is the protection; the save-time warning is not.** A warning is a snapshot of the catalogue and stops being true the moment a cheaper service is created. The warning exists so the owner learns at a moment they can act on it.
  - The replacement confirmation shows **what the policy charges against real service prices** (`Corte $10.000 → seña $300`), computed on the server through the same rule the booking flow uses. It is the only thing that catches a value off by a factor of ten, and a client-side preview was rejected because it would be a second implementation of a money calculation.
  - The percentage is a **whole number** 1–100 — the owner's call, over the two decimals the column would allow. `depositType` is never defaulted from the column: a `50` meant as fifty pesos, stored as fifty percent, is off by whatever the service costs, and neither half of that pair looks wrong alone.
  - PC3 **reports** the bookability gate and B4 enforces it. `isBookable()` had been referenced in `PaymentConfig.ts` since PC1 and deliberately never written for want of a caller; this is the caller. The readiness panel constructs no cipher, so a missing `PAYMENT_CREDENTIALS_KEY` cannot take down a page about deposit amounts.
  - Verification against the live database earned its keep twice: it caught a **money bug** — the driver drops a trailing zero, so a stored `2000.50` read back as `2000.5` and integer-cent arithmetic took the lone `5` as five centavos. M3 had documented that exact failure for `Service.price`; its helper is now extracted and shared. Driving the real page caught a second defect, a stale "guardada" surviving a removal.
  - Closed **T41** before the collision it described was reachable, which is what the entry asked for. Decided **T44** for B4. **T45** is new and honest: the minimum-deposit floor is a placeholder until B5 can confirm it.

### 1c. Public booking flow

- [x] **B1** — As a client, I want to open the shared link and see the barbershop's public profile with a "Reservar" button, so that I can start a booking. — *depends on: P1*
  - **The first route in this project served to someone without a session**, and the first database read reachable without one. Both properties had been deliberate since A1, and this story breaks both on purpose.
  - The guard's exception is an **exact-segment** test (`=== '/b'` or `startsWith('/b/')`). A bare `startsWith('/b')` would have opened `/barberos` and everything beneath it — every barber, schedule and absence — with no symptom, since the pages would simply render. That is the one defect here a browser check cannot catch, so `routeGuard.test.ts` names those paths explicitly.
  - `findByPublicSlug` is the **only** repository method in the project that carries no `ownerId`. `IBusinessProfileRepository` used to assert that an unscoped query was inexpressible through it; that sentence is now a named exception with its reason, because on the public page the slug *is* the key. It is bounded by returning a `PublicBusinessProfile` **projection** — written as an allowlist of publishable columns, so a field added to the model reaches nobody until someone adds it there too.
  - **One canonical URL per shop.** An exact match renders; a spelling that normalizes to a stored slug 308s to the canonical URL; anything else is a real 404. Because stored slugs are always canonical, normalizing first means one query answers both cases instead of a miss-then-retry on the path an enumeration would hammer.
  - The route parameter is the one value in this feature supplied entirely by a stranger, and it is unbounded while the column is not — so overlong, traversal and null-byte values are refused **before** any query.
  - Absolute metadata comes from `APP_ORIGIN` **or is omitted**; the `Host` header is never a fallback here. On `/perfil` that fallback was an owner spoofing a header addressed to themselves; on a public page it would make a shop advertise an attacker's origin. Failing the route instead was rejected: the page it would break is the only one that earns the business money.
  - **"Reservar" ships inert**, disclosed in Spanish — the same answer P1 gave one story earlier for a link that did not resolve yet. It does **not** consult bookability, and the public composition root hands over no `PaymentConfig` repository at all: that row holds the encrypted Mercado Pago token, and a page anonymous visitors open should have no relationship with it. **The gate is B2's.**
  - No new infrastructure: no migration, no environment variable, no image service, no cache. Images are plain `<img>` with reserved space — P1's client-side downscale already solved the payload problem, and `next/image` is both unconfigured and unproven on `workerd`.
  - Fixed `lang="en"` on the root document, which had been announcing this entirely Spanish product with English phonetics since S0, and retired the scaffold's `create-next-app` title.
  - Corrected two tech-debt entries whose written justifications this story falsified — **T33** ("the cost is currently zero") and **T17** ("the dashboard routes are not publicly linked") — and opened **T47** for the absent cache and rate limit on the new public read.
- [x] **B2** — As a client, I want to choose a location, then a service, then a barber of that location who performs it, so that my booking matches how the business operates. — *depends on: B1, M4*
  - **Two gates, not one, and B2 owns only the first.** This entry originally listed "or a deposit policy" among the conditions, which conflated them. The **catalogue** gate — is there anything to book — is B2's. The **payment-readiness** gate — can a deposit be charged — stays with B4 and `PaymentConfig.isBookable()`. The accepted consequence is named rather than discovered: a client can finish all three steps at a shop with no deposit configured and meet the wall at B4.
  - **The public route keeps away from `PaymentConfig`,** as B1 required: no Supabase client, no cipher, no payment repository in either composition root. That row holds the encrypted Mercado Pago access token, and bookability is derived from `BarberService` and the catalogue instead.
  - **The unit of bookability is the `(service, location)` pair** — what `docs/tech-debt.md` T23 was waiting on since M4. A service with active barbers at one branch and none at another is offered at the first and absent at the second. The dashboard still reports one global fact per service; that half of T23 stays open, deliberately, as an owner-facing gap no client can reach.
  - **The first route whose inputs are entirely stranger-supplied.** B1 took one hostile value in the path; B2 takes three more in the query string, each a key into owner-scoped data. A cross-owner id and an unknown id produce byte-identical responses — a differential answer would be an existence oracle on a route with no rate limit.
  - **A stale link degrades, it never 404s and never substitutes.** Upstream selections that still resolve survive; the first that does not is dropped with everything below it. Links live in WhatsApp threads and outlive the catalogue they were built from, so this is the ordinary path.
  - Closed a real gap B1 left: the canonical 308 covered `/b/{slug}` only, so `/b/{SLUG}/reservar` answered at every spelling. It now redirects **with the query string intact** — B1 chose 308 for being method-preserving precisely because B4 will POST here.
  - **Revised mid-implementation:** the design had the profile page resolve the owner through a second read, which would have meant reading the same row twice by the same unique key. B1's `findByPublicSlug` was widened to return `{ profile, ownerId }` instead — one extra column, projection unchanged. Recorded in design D3/D10.
  - Opened **T48** (a 50-service step has no scan-time answer) and re-costed **T47**, which now covers two public routes and a parameter space a crawler can sweep.
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
