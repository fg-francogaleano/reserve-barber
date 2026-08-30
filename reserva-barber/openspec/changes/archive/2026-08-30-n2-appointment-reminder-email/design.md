# N2 — Design

## Context

Two capabilities meet here and neither one fits without adjustment.

**From N1** comes everything about sending: `IEmailSender` and its four outcomes, `ResendEmailSender` over the platform `fetch` with no SDK, `emailText.ts`'s escaping and header rules, `publicOrigin.ts`'s reachability check, the `EmailCapability` value that keeps two message types from inheriting each other's log identity, and `COPY.email` as the place Spanish lives. All of it is reused unchanged. **What does not come from N1 is its idempotency**, because N1 never had a mechanism — it had a guarded status transition, and got at-most-once as a consequence. `Booking.confirmationEmailSentAt` says so in bold in its own doc comment.

**From B7** comes everything about running on a schedule: the `reserva-barber-cron` Worker, which exists as a separate deploy because a custom entrypoint that imports application code makes wrangler's esbuild bundle the Prisma query compiler a second time (3812 KiB gzip against the free plan's then-current 3072 KiB ceiling — measured, not argued). **T51 has since closed** — Franco took Workers Paid before N1, so the ceiling is 10 MiB — but T51's own closing note is explicit that this does not retire B7's split: shipping the query compiler twice was a correctness-of-bundling problem, not a size-limit one, and 10 MiB does not make it a good idea. With it come the batch bounds, the single-instant rule, the guarded-update pattern, the not-owner-scoped port with its stated exception, and the requirement that every invocation emits a summary because silence is a scheduled job's failure mode.

**What is genuinely new is small and sits in one place:** a job whose trigger is time passing has nothing to key a send on, so the read and the mark must be one statement, and that statement must run *before* the send rather than after it. Every other decision below follows from that one.

**One constraint bounds the whole design, and a second turned out not to.** **T76**: no verified sending domain, so production cannot send and must not be given the key — this story cannot close that and must not pretend otherwise.

**T51 was carried into this plan as a live constraint and the baseline measurement retired it.** The plan assumed a 3072 KiB ceiling and treated `src/lib/copy.ts` — 85 KB of a single object literal that tree-shaking cannot narrow — as a real risk to the cron Worker's headroom. Measured on this branch's parent commit: the cron Worker is **879.54 KiB gzip** against a **10 MiB** ceiling, roughly 9.1 MiB free. The copy module is noise. The measurement is still taken, because this project measures rather than assumes and because a surprise there would mean something else went wrong, but it is no longer a decision input.

For the record, and because these figures are the trend T51 tracked for eight stories: the **application** Worker measures **3198.40 KiB gzip** on `main` today, against 3068.31 KiB at N1's deploy — +130 KiB across C1, C2 and D3–D7. Under the free plan that would now be a rejected deploy; under 10 MiB it is 31% of the ceiling.

## Goals / Non-Goals

**Goals:**

- One reminder per confirmed appointment, a fixed lead before it starts, carrying the cancellation link as the point of the message rather than as a footnote.
- **At-most-once, provably, against a job that runs repeatedly by design** — including two overlapping invocations, a manual `--test-scheduled` fired during a live run, and a Worker that dies mid-batch.
- A first production run that cannot mail the past. This is the story's highest-consequence failure and it is designed out rather than tested for.
- A failure mode that is queryable rather than only loggable, on the same terms N1 established.
- Zero user-facing surface, zero new dependencies, zero change to the application Worker.

**Non-Goals:**

- Retrying a failed reminder. A retry needs an attempt count or an un-claim, and both reintroduce the duplicate this design exists to prevent.
- A second reminder at a shorter lead, rescheduling, SMS/WhatsApp, or an owner-facing "not yet reminded" surface.
- A per-shop lead time. No owner has expressed a scheduling policy on any surface in this product (T78's reasoning).
- Closing T76. The DNS step is Franco's and this story is blocked on it for its runtime proof, exactly as N1 was.
- Exactly-once against a human cancelling concurrently. Bounded below, not eliminated.

## Decisions

### D1 — The claim is the read: one statement selects and marks

An `UPDATE … SET "reminderEmailSentAt" = $now WHERE id IN (…) AND "reminderEmailSentAt" IS NULL AND status = 'CONFIRMED' RETURNING …`, over ids from a bounded candidate query. The returned rows are the ones this invocation owns; every other invocation gets zero rows for them.

**Alternative rejected — read, then send, then record (N1's shape).** N1 can do that because its at-most-once comes from somewhere else entirely. Here the recorded column *is* the guarantee, so a gap between deciding to send and recording it is a gap in which the next run re-decides. A Worker that dies after `send()` resolves, a provider that accepts then times out, a redeploy mid-run — each leaves the row unclaimed and the next tick re-sends. On an hourly cadence a booking 24 hours out collects a reminder per hour.

**Alternative rejected — a separate `reminderClaimedAt` alongside `reminderEmailSentAt`.** It buys the ability to distinguish "claimed but never confirmed sent" from "sent", which is a real distinction. It costs a second nullable column on `Booking`, a second thing to reason about in every future query about reminders, and — the deciding point — it does not enable a retry anyway, because a claimed-and-unconfirmed row is precisely the row that might already have been delivered. Paying two columns for a distinction nothing may act on is the wrong trade. The single column plus a log line at error is the same information, in the place operators already look.

**The consequence, stated rather than hidden:** a send that fails leaves a client unreminded with no automatic recovery. That is deliberate, and it is the same shape N1 accepted for a *confirmation* — a message that matters more.

### D2 — The candidate window ends at `startTime`, and beginning at `now` is the safety bound

`status = 'CONFIRMED' AND "reminderEmailSentAt" IS NULL AND "startTime" > now AND "startTime" < now + REMINDER_LEAD_HOURS`.

**`startTime > now` is not a filter, it is the bound that stops this story mailing every client the shop has ever had.** Without it the first production run selects every confirmed booking in history — every gate-script row, every development booking, every real appointment since B4 — and mails all of them. B7 records the same hazard about its first unbounded run; there the cost was a pooler, here it is people's inboxes, and it is unrecoverable.

**Alternative rejected — a window around a target instant**, `startTime BETWEEN now+LEAD AND now+LEAD+CADENCE`. It is the obvious shape and it is fragile in a specific way: correctness becomes a relationship between two numbers that live in different files, one of them a cron expression in a JSONC comment block. A missed run, a Worker outage, a slow deploy, or a cadence changed without changing the window, and bookings fall through the gap silently and permanently. The chosen shape is **self-healing** — anything missed is still a candidate on the next tick — and it needs no knowledge of the cadence at all.

The cost is that the query's selectivity depends on the partial index rather than on a narrow range. That is D6.

### D3 — `REMINDER_LEAD_HOURS = 24`, `REMINDER_MIN_GAP_HOURS = 3`, declared as judgements

Both live beside `EXPIRY_GRACE_MINUTES` in the booking-horizon constants, and both carry that constant's disclosure: a judgement no real shop has measured.

Twenty-four hours because it is the largest lead at which a client still remembers making the booking, and the smallest at which a released slot is still resellable to somebody else — the two things the message is for. Absolute hours, not "the same local time yesterday": `America/Argentina/Buenos_Aires` observes no DST today, and an absolute lead is the version that stays correct if that ever changes. It also disposes of quiet hours for free — a 09:00 appointment is reminded at ~09:00, never at 03:00 — which a fixed send-hour design would have had to solve separately.

**The three-hour minimum gap exists because of D2's shape.** A booking created inside the lead window is immediately a candidate, so a client booking at 08:00 for 09:30 gets a "reminder" minutes after the confirmation that carried the identical appointment and the identical link. Suppressed by `startTime - createdAt >= REMINDER_MIN_GAP_HOURS`.

**`createdAt`, deliberately not `updatedAt`.** `markConfirmationEmailSent` bumps `updatedAt` on every confirmed booking (Prisma's `@updatedAt`, measured by the N1 gate), so `updatedAt` is not the booking's age. And deliberately not a new `confirmedAt` column: the gap this rule cares about is "was there ever time for this to be forgotten", which `createdAt` answers, and adding a column to avoid a judgement call is how tables grow.

**T78 applies with one difference worth naming.** T78 refused to invent a cancellation-notice window because a window of zero is a coherent product. A *lead* of zero is not — it would be no feature at all — so a number must exist here. The direction chosen is the one that degrades gracefully: too long a lead is a message a client reads and forgets; too short a lead is a message that arrives after they have already made other plans.

### D4 — A second cron on B7's Worker, dispatched on `event.cron`

`wrangler.cron.jsonc` gains `"0 * * * *"` beside `"*/5 * * * *"`, and `scheduled()` dispatches on `event.cron` to one of two jobs.

**Alternative rejected — a third Worker.** It would give perfect isolation, and it would cost a third deploy, a third `DATABASE_URL` upload (the operation that cost B7 an hour, twice), and a third place for the Prisma query compiler. The two jobs are the same shape against the same database with the same lifetime; they belong together.

**Alternative rejected — one handler calling both jobs.** `sweep.ts` rethrows on failure specifically so the platform marks the invocation failed — a dead job that looks healthy is the failure this whole capability family is written against. Sharing a handler means either the reminder's fault marks the sweep failed, or the sweep's rethrow prevents the reminder's summary from being emitted. Dispatching keeps both properties.

**Hourly, not five-minutely.** At a 24-hour lead nothing observable depends on the message landing within five minutes, and 288 daily invocations against a pooler capped at five connections — shared with the dashboard and the public booking write — buys nothing. The cadence is a data-freshness choice, exactly as B7 states about its own, and D2's self-healing window means it can be changed without touching any rule.

### D5 — `createEmailSender` gains an explicit-configuration entry point

Today it reads `process.env[RESEND_API_KEY]` and `process.env[EMAIL_FROM]`. **A scheduled invocation has no request context**; `worker/sweep.ts` documents that bindings arrive on the handler's `env`, which is exactly why it imports `createPrismaClient(connectionString)` rather than the request-memoized `getPrismaClient`.

The factory splits: `createEmailSenderFrom({ apiKey, from }, logger, capability)` holds the logic including `UnconfiguredEmailSender`, and the existing `createEmailSender(logger, capability)` becomes a thin Next.js-side wrapper that reads `process.env` and delegates. The Worker calls the former with values off `env`.

**Alternative rejected — relying on `nodejs_compat` to populate `process.env` from Worker secrets.** Recent workerd versions do this under some compatibility dates, and this Worker is pinned at `2025-09-01`. Depending on it would make the feature's correctness a property of a runtime behaviour nobody here has measured — which is precisely the assumption B5 was built to refuse, having measured `Intl` and `fetch` rather than assuming them. The explicit parameter costs one function signature and cannot be wrong.

**Why this is the design's most dangerous line if got wrong.** With the claim already written (D1) and the sender unconfigured, `UnconfiguredEmailSender` returns `rejected` for every booking — so every row is permanently marked reminded, nobody is reminded, and every page, test and status check still looks correct. It fails completely, once, silently, and irreversibly. Hence: a test that constructs the Worker's composition root and asserts a configured sender, and a gate step that runs the real path.

### D6 — One partial index, in raw SQL, following `b7_expired_hold_indexes`

```sql
CREATE INDEX "Booking_reminder_due"
  ON "Booking" ("startTime")
  WHERE status = 'CONFIRMED' AND "reminderEmailSentAt" IS NULL;
```

Prisma cannot declare a partial index, so it lives in the migration and is named in the `Booking` model's existing "INDEXES PRISMA CANNOT DECLARE" comment block — the same treatment B7's two indexes received, for the same reason: a schema file mistaken for the whole truth is how an index silently stops existing.

The predicate is what makes it small. Once a booking is reminded it leaves the index; a shop's index holds only its unreminded future appointments. **The plan is confirmed with `EXPLAIN ANALYZE` against the live database before this story closes** — D1 and D7 both indexed by measurement rather than assumption, and B7's own note that `(barberId, startTime)` cannot serve a query naming no barber applies here too.

### D7 — Its own port, not-owner-scoped, with the exception stated

`IBookingReminderRepository`, separate from `IBookingRepository`. **This is the product's second cross-owner write**, and `IExpiredHoldRepository` is the precedent for how to admit one: a port of its own whose contract states that it is deliberately not owner-scoped and why, rather than widening a repository that asserts an unscoped query is inexpressible through it. `findByPublicSlug` is the precedent for that precedent — a named exception, bounded by a projection.

Bounded the same way: the claim returns exactly the fields the message needs. Cross-owner isolation proven by a test whose fixture holds two owners, as B7 requires of itself.

### D8 — A new builder, not a parameter on the confirmation's

`bookingReminderEmail.ts` beside `bookingConfirmationEmail.ts`, sharing `escapeHtml`/`headerSafe`, `formatCurrency`, `formatBookingDateLong`, `businessToday`/`formatSlotTime`, and `toCents`/`fromCents`. Sharing stops at the helpers.

**Alternative rejected — `buildBookingEmail({ kind: 'reminder' | 'confirmation' })`.** The two messages have the same fields and different jobs: one is a receipt for money that moved, the other is a prompt to act while acting is still useful. A boolean that switches subject, greeting and link description is a function whose every reader must hold both messages in their head, and the first divergence adds a second boolean. Two pure functions with a shared toolkit is the shape N1 already argued for when it kept escaping in the domain rather than the adapter.

The message inherits N1's rules verbatim: business-local time through the shared calendar module, money from canonical decimal strings through integer cents, a plain-text alternative, no remote assets, the complete URL visible as text, guest values escaped in the body and absent from every header, and the subject composed from server-held values.

**The link's description names cancelling** — `booking-confirmation-email` already required that of the confirmation once C1 shipped, and here it is the message's reason to exist. It still does not link to the cancellation itself: that is a `POST` behind a confirmation, and a URL that performs it would defeat the reason it is one.

### D9 — No origin still sends, and the loss is larger than N1's

Same resolution path — configured value, `isPubliclyRoutableHost`, else `null` — and the same decision: send without the link, log at error. But the spec states the asymmetry rather than inheriting it silently. **A confirmation without a link is still a receipt; a reminder without a link has lost the whole reason it was sent.** A client told "your appointment is tomorrow at 15:00" with no way to release it is left exactly where they were before the message.

`APP_ORIGIN` therefore becomes a cron-Worker variable, and `wrangler.cron.jsonc`'s comment stating that it has no `APP_ORIGIN` and no `ASSETS` binding is **rewritten**, not left standing. Half of it stays true and load-bearing (no `fetch` handler, reachable by nobody); the half this story falsifies is corrected in place — B1's treatment of T33 and T17, B6's of `bookingConfirmationService.ts`.

### D10 — One summary per invocation, including the empty ones, and `throttled` kept distinct

B7's requirement transfers whole: an invocation that reminded nobody emits a summary saying so, carrying candidates examined, claimed, sent, failed by outcome, batches and duration. **This job's natural failure is silence, and silence must not also be its success mode** — nothing else in the product looks wrong when reminders stop.

`throttled` stays separate from `rejected` in the log, and T71's stated shape gets sharper here: reminders arrive as a burst rather than spread across the day, so the most likely production failure is **reminders exhausting the quota and every confirmation after them being throttled** — the message carrying no money starving the one that does. This design does not fix that; it makes it the one thing a log filter can find.

### D11 — One instant per invocation, batches bounded, no advisory lock

The clock is read once at the start and used for the window bound, the minimum-gap comparison and the claim's timestamp. B7's rule: two clocks, one decision, is how a row becomes eligible by one reading and live by the other. The database's `now()` is never consulted.

Bounded batches with a per-invocation cap, reusing B7's constants or declaring equivalents with the same reasoning — a job that *cannot* overrun is a job that cannot take the pooler down with it, and D2's window means the remainder is simply next hour's work.

**No advisory lock.** Every caller of the per-barber lock *places* a booking into a slot; this one reads and marks, and cannot double-book. The same reasoning B7's sweep and the receipt rejection both record. Safety is the guarded update.

### D12 — Claim in small batches and send immediately, to bound the cancellation race

The claim's `status = 'CONFIRMED'` guard closes read-to-claim: a booking cancelled through C1 or C2 in that gap matches zero rows. **Nothing closes claim-to-send**, and nothing can — a human can cancel while the provider is accepting the message.

The mitigation is structural, not clever: claim a small batch, send it, claim the next. The window is milliseconds per booking rather than the whole invocation. The residue is stated in the spec rather than papered over — a reminder for an appointment cancelled seconds earlier is embarrassing and harmless, and a claim to have eliminated it would be false.

## Risks / Trade-offs

- **[The first production run mails the past]** → `startTime > now` is a spec requirement (D2), a unit test, and a gate probe that plants a confirmed past booking and asserts it is never selected. Ranked first because it is the only failure here that is both unbounded and unrecoverable.
- **[Configuration resolves absent in the Worker and every booking is marked reminded with nothing sent]** → D5's explicit parameter removes the runtime dependency; a composition-root test asserts a real sender; the gate exercises the real path. This failure is silent on every surface, which is what makes it worth three defences.
- **[A failed send is never retried, so a client is silently unreminded]** → Accepted, and made queryable: `reminderEmailSentAt IS NOT NULL` with a logged non-`sent` outcome is findable, and the population is bounded by the invocation summary. The alternative reintroduces duplicates (D1).
- **[The cron Worker's size]** → **Retired by measurement before implementation began.** The plan carried it from T51 as a live risk; the baseline is 879.54 KiB gzip against 10 MiB. The measurement is still taken after the change, because an unexpected jump would mean something other than size went wrong — an accidental import of a page, a route or a React component into a Worker that must contain none of them.
- **[Reminders exhaust the mail quota and starve confirmations]** → T71, sharpened by burst arrival (D10). Not fixed here; the `throttled` outcome is the only handle, and the invocation summary now gives it a denominator.
- **[A reminder lands for an appointment cancelled seconds earlier]** → Bounded to milliseconds by small batches (D12), not eliminated. Stated in the spec.
- **[Two columns with opposite semantics on `Booking`]** → `confirmationEmailSentAt` explicitly is not an idempotency key; `reminderEmailSentAt` explicitly is. The schema comment names the neighbour and the difference, because the next reader will otherwise generalise from whichever they read first.
- **[The story cannot be verified end to end in production]** → T76, unchanged, and worse here than for N1: a broken reminder has no user-visible surface at all, so its failure and its success are byte-identical to a client. Recorded at close rather than waived; the key stays unset.

## Migration Plan

1. Migration: the nullable column and the partial index, in one file. Backfill-free — every existing confirmed booking gets `null`, which is correct: an unreminded future appointment becomes a candidate, and a past one is excluded by D2.
2. Ship the code with **no cron expression added**. The job is dead code on a Worker nobody can reach — the deploy is verifiable in isolation, and the bundle can be measured before anything is scheduled.
3. Measure the cron Worker's gzip size against the recorded pre-change figure; record both.
4. Run the gate script against the live database. Fire `wrangler dev -c wrangler.cron.jsonc --test-scheduled` by hand, since no unit test executes the entrypoint.
5. Set `APP_ORIGIN` and `EMAIL_FROM` on the cron Worker. **Leave `RESEND_API_KEY` unset**, per T76 — the job then runs, claims nothing, and reports an unconfigured sender by name, which is a state the design already handles.
6. Add the cron expression last. This is the only irreversible step, and it is one line.

**Rollback** is removing the cron expression: the job stops, no row changes, and an unreminded booking is indistinguishable from one whose reminder is not yet due. The column and the index are inert without the schedule, so neither needs reverting. This is the same rollback shape `wrangler.cron.jsonc` already documents for B7.

## Open Questions

- **Is 24 hours the right lead?** Declared as a judgement (D3) and cheap to change — a constant, with no rule depending on it. The trigger for revisiting it is the first real shop, not a further argument.
- **Should the three-hour minimum gap instead suppress on "the confirmation was sent less than N hours ago"?** It is the more precise question and it needs a `confirmedAt` the schema does not have. `createdAt` answers a near-enough one for a booking that confirms within its hold window, which every booking does.
- ~~**Does the cron Worker have headroom for the whole `COPY` object?**~~ **Answered before implementation: yes, by a factor of ten.** 879.54 KiB gzip against 10 MiB. The reminder-scoped copy module that was the fallback is not needed and would be premature.
- **Should a failed reminder eventually get one retry?** Deliberately not now (D1). The question becomes answerable once production has a `throttled` or `retry` count to look at, which is what D10's summary provides.
