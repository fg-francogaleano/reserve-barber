# N2 — Tasks

> Ordered so that the two failures that are silent on every surface — mailing the past, and an unconfigured sender claiming every row — are each covered by a failing test before the code that could commit them exists.

## 1. Baseline, before anything is added

- [x] 1.1 Record the cron Worker's current gzip size: `npx wrangler deploy -c wrangler.cron.jsonc --dry-run`. This is the figure every later measurement is compared against, and it must be taken before a single import is added. — **2561.91 KiB / gzip 879.54 KiB**, against 878.62 KiB recorded at N1's close: the cron Worker is untouched by D1–D7, as expected.
- [x] 1.2 Record the application Worker's current gzip size the same way, so a regression there is attributable rather than discovered. — **13345.91 KiB / gzip 3198.40 KiB** on `main` at `00254db`, against 3068.31 KiB at N1's deploy: **+130 KiB across C1, C2 and D3–D7**. Under the free plan that is now a rejected deploy; against the paid plan's 10 MiB it is 31%.
- [x] 1.3 Confirm the working tree is clean and branched from an up-to-date `main` — the shared database makes a stale branch propose `migrate reset`. — Branched `feat/n2-appointment-reminder-email` from `origin/main` at `00254db` (D7's merge, PR #33).
- [x] 1.4 **Correct the plan against the baseline.** T51 is **closed** — Franco took Workers Paid before N1, so the ceiling is 10 MiB, not 3072 KiB. The proposal and design carried it as a live constraint and treated `src/lib/copy.ts` as a real risk to the cron Worker's headroom; at 879.54 KiB against 10 MiB it is noise. Both artifacts updated before any code was written, per the spec-first policy. The historical references to B7's 3812-vs-3072 measurement are kept and marked as historical, because T51's own closing note keeps the two-Worker split standing for a reason size no longer supplies.

## 2. The schema, and the column whose semantics invert its neighbour's

- [x] 2.1 Write the failing test first. **Written as a schema test, not the repository test the task originally named** — the repository does not exist until group 4, and its claim behaviour is 4.2's; what has to fail *here* is the column, its doc comment, and the migration. Follows `schemaUnchangedByC1.test.ts`. Five assertions, all red, including one holding the doc comment that separates this column from `confirmationEmailSentAt` — the comment is the only thing standing between a reader and a wrong generalisation, so a test holds it in place.
  - Two of the five had to be fixed for lying before they were allowed to pass. The comment assertion passed vacuously while the column was absent (`indexOf` returns −1, `slice` spans the rest of the file, and the words are found in unrelated text), and the no-backfill assertion failed on the migration's own rationale, because a scan of the whole file cannot tell a comment from a statement — D7 and B7 each recorded that same limitation about their own scans.
- [x] 2.2 Add `reminderEmailSentAt DateTime? @db.Timestamptz(3)` to the `Booking` model, with the doc comment that **names `confirmationEmailSentAt` directly and states the difference**: that one is not an idempotency key, this one is, and why (no guarded transition to key on).
- [x] 2.3 Generate the migration. Verify by inspection that it adds one nullable column and changes no data.
- [x] 2.4 Add the partial index to the same migration as raw SQL: `CREATE INDEX "Booking_reminder_due" ON "Booking" ("startTime") WHERE status = 'CONFIRMED' AND "reminderEmailSentAt" IS NULL;`
- [x] 2.5 Add the index to the `Booking` model's existing "INDEXES PRISMA CANNOT DECLARE" comment block, with the sentence explaining what its predicate bounds.
- [x] 2.6 Apply the migration against the live database and confirm the index exists.
- [x] 2.7 Update `docs/data-model.md` for the column and its inverted semantics, in the same change — never as follow-up.

## 3. The domain constants and the eligibility rule

- [x] 3.1 Failing tests for the eligibility predicate: a past appointment is never eligible; an appointment beyond the lead is not yet eligible; an appointment inside the lead is; a booking whose `startTime - createdAt` is under the minimum gap is not.
- [x] 3.2 Declare `REMINDER_LEAD_HOURS = 24` and `REMINDER_MIN_GAP_HOURS = 3` beside `EXPIRY_GRACE_MINUTES`, each stating in the source that it is a judgement no real shop has measured, and each expressed as an absolute duration.
- [x] 3.3 Add `reminderDueBefore(now)` alongside `holdSweepCutoff`, and make the tests in 3.1 pass.
- [x] 3.4 A test asserting the lead is applied as a fixed duration and not by constructing a local calendar time.

## 4. The cross-owner port and its Prisma implementation

- [x] 4.1 Write `IBookingReminderRepository` with the contract stating it is **deliberately not owner-scoped and why**, following `IExpiredHoldRepository`'s precedent. Declare the projection type carrying only what the message renders — no phone, no owner id.
  - **Two projections, not one**, which the plan did not anticipate. A candidate is not yet a recipient — `isReminderDue` may reject it, the claim may lose it to an overlapping invocation — so `findDueCandidates` selects three columns and no personal data at all, and the message shape is read only for rows the claim actually won.
- [x] 4.2 Failing tests for the claim: it matches zero rows when the status changed underneath; it matches zero rows on a second run; it writes only the reminder instant.
- [x] 4.3 Implement `PrismaBookingReminderRepository`: candidate query filtering on status, null reminder instant, `startTime > now`, `startTime < now + lead`, ordered by `startTime` ascending, with a row limit; then the guarded claim. No transaction, no advisory lock, no eligibility rule restated in SQL beyond the bounds the index serves.
  - **`updateManyAndReturn`, not `updateMany`.** A count would force a read-back to discover *which* rows were won, and between the update and that read another invocation could do anything — reopening the exact window the claim exists to close. The mock omits `updateMany`, `$transaction` and `$executeRaw` so an implementation reaching for any of them fails as "not a function" rather than passing quietly.
  - A row whose shop has no `BusinessProfile` is **dropped rather than sent**: the public slug the link is built on lives there, and a link composed on an absent slug is a permanent 404 in an inbox. Unreachable today; the projection admits it, so the code answers it.
- [x] 4.4 A test whose fixture holds **two owners**, asserting that a run claims both owners' due bookings and touches neither owner's already-claimed or non-due rows. — Both queries additionally asserted to carry no owner-shaped predicate, since there is no owner in scope for a job triggered by a clock. 16/16 green.
- [x] 4.5 `EXPLAIN ANALYZE` the candidate query against the live database; confirm the partial index is used and record the plan with the change.
  - `Index Scan using "Booking_reminder_due"`, with **both** range bounds pushed into the `Index Cond` and **no `Filter` line at all** — the partial index's predicate absorbs the status and null clauses entirely. Planning 0.684 ms, execution 0.869 ms.
  - **The 24-hour window returns zero rows, and that was checked for being zero for the right reason.** The table holds 23 bookings, 8 `CONFIRMED`, of which 2 start in the future and neither within 24 hours. Widening the window to 365 days returns exactly those 2 through the same index scan — so the empty result is the rule working, not the query failing to match. A plan measured against 23 rows proves the index is *chosen* and the predicate is *absorbed*; it cannot prove anything about scale, and does not claim to.

## 5. The message

- [x] 5.1 Add `COPY.email.reminder` beside `confirmation` and `cancellation` — Spanish (es-AR), subject, greeting, the detail labels, and the link description that **names cancelling** without implying the link itself cancels.
- [x] 5.2 Add `BOOKING_REMINDER_EMAIL` to `emailCapability.ts` with `operation: 'email.bookingReminder'` and an English log subject.
- [x] 5.3 Failing builder tests: business-local date and time; balance computed in integer cents and omitted when zero; a client name containing markup appears escaped; a client name containing CR/LF reaches no header; the complete URL appears in the plain-text part; no remote asset is referenced; with a null origin the message is composed with no URL at all.
- [x] 5.4 Write `bookingReminderEmail.ts` as a **pure function of its own** — not a parameter on the confirmation builder — reusing `escapeHtml`/`headerSafe`, `formatCurrency`, `formatBookingDateLong`, `businessToday`/`formatSlotTime`, `toCents`/`fromCents`.
- [x] 5.5 A test asserting the confirmation builder gained no message-kind parameter.

## 6. The sender factory, split so a scheduled caller can configure it

- [x] 6.1 Failing test: `createEmailSenderFrom({ apiKey, from }, logger, capability)` returns a sending adapter without reading `process.env`, and returns the unconfigured sender when either value is absent.
- [x] 6.2 Extract the logic into that entry point; reduce `createEmailSender(logger, capability)` to a wrapper that reads `process.env` and delegates.
- [x] 6.3 Regression test: both existing confirmation call sites (the notification endpoint and the receipt review) behave exactly as before, including the missing-configuration entry being emitted once per attempted send rather than per construction.

## 7. The application service

- [x] 7.1 Failing tests for `BookingReminderService`: a past booking is never claimed; a claimed booking is sent exactly once; a failed send leaves the claim in place and logs at error; a second run claims nothing; batches are bounded and the remainder is left; one instant is used for the window, the gap and the claim; every batch is claimed and sent before the next batch is claimed.
- [x] 7.2 Failing test for the summary: an invocation with nothing due emits one summary recording zeros; `throttled` is distinguishable from `rejected` in the outcome counts.
- [x] 7.3 Failing test for the origin: a null or private origin still sends, omits the link, and logs at error with a distinguishable reason.
- [x] 7.4 Implement the service. No `try` that can swallow the summary; the clock read once; the origin injected, never read here.
- [x] 7.5 Failing test then implementation for log hygiene: no recipient address, client name, phone, cancellation token, composed link or credential appears in any line, and every line carries this capability's operation name and not the confirmation's.

## 8. The entrypoint

- [x] 8.1 Rename/refactor `worker/sweep.ts` into a dispatching entrypoint (or add `worker/scheduled.ts`) that selects a job from `event.cron`. Keep the sweep's existing rethrow behaviour exactly.
  - Landed as **two** files, and not by preference — see 10.3. `worker/jobs.ts` holds the schedules, the composition roots and the dispatch; `worker/scheduled.ts` is the entrypoint and exports **nothing but its default**.
  - `vitest.config.ts` gained `worker` to its server globs. Nothing under `worker/` had ever been collected, which is why B7 could only require that the trigger be fired by hand. The config's own comment about `app` argues for exactly this: a test in an uncollected directory never runs and the suite still reports green.
- [x] 8.2 Wire the reminder's composition root from `env`: `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`. **A test asserting this root constructs a configured sender when `env` supplies the values** — this is the defence against the failure that marks every booking reminded while delivering nothing.
- [x] 8.3 Test that a fault in one job does not mark the other's invocation failed, and that the sweep's rethrow does not suppress the reminder's summary.
- [x] 8.4 Add `APP_ORIGIN` and `EMAIL_FROM` to `wrangler.cron.jsonc`, and **rewrite the comment asserting the Worker has no `APP_ORIGIN`** — keep the half that is still true (no `fetch` handler, reachable by nobody), correct the half this change falsified. Document the `RESEND_API_KEY` upload as `secret bulk` from a BOM-free JSON file.
- [x] 8.5 Do **not** add the cron expression yet.

## 9. Measure before scheduling anything

- [x] 9.1 Re-measure the cron Worker's gzip size. Record before, after, delta and remaining headroom against **10 MiB** (see 1.4). The figure is no longer a gate; an unexpected jump means a page, a route or a React component reached a Worker that must contain none of them.
  - **879.54 → 913.54 KiB gzip, +34.00 KiB.** ~9.1 MiB of headroom. Nothing under `app/` or `components/` entered the bundle.
- [x] 9.2 Assert the delta is proportionate to the surface added. The reminder-scoped copy module that 9.2 originally held as a fallback is **not needed** — 1.4 retired the premise.
  - Proportionate, and the interesting part is how small it is: `src/lib/copy.ts` is 85 KB raw and the **whole** change — the copy module, the builder, the service, the port, the repository, the Resend adapter and `publicOrigin` — costs 34 KiB gzip together. The plan treated that copy import as the risk; it is a fraction of one story's ordinary growth.
- [x] 9.3 Confirm `package.json` is unchanged — no vendor SDK. — `git diff origin/main -- package.json package-lock.json` is empty.
- [x] 9.4 ~~Confirm the application Worker's size is unchanged from 1.2.~~ **The premise was wrong and the measurement says so.** It cannot be unchanged: `src/lib/copy.ts`, `Booking.ts`, `bookingHorizon.ts` and `emailCapability.ts` are all imported by pages, so the reminder's copy block, its two constants, its predicate and its capability constant ship in the application Worker too.
  - **3198.40 → 3207.98 KiB gzip, +9.58 KiB.** That is the honest number, and it is what a shared domain module costs. Nothing reminder-specific beyond those four files reaches it — no builder, no service, no repository — which is the property that actually mattered and which the figure supports.

## 10. Gates

- [x] 10.1 Write the live gate script following B7's: a confirmed past booking is never selected; a due booking is claimed exactly once; a re-run claims nothing; a status change between selection and claim makes the claim match zero rows; a short-notice booking is suppressed; a second owner's rows are untouched. Everything it creates is removed in foreign-key order. — `scripts/n2-gate.ts`, 20 probes across 11 sections. It sends no mail: the sender is a recording stub, because T76 stands and a real send would reach one mailbox while claiming every row it touched.
- [x] 10.2 Run it against the live database. Record the output with the change. — **GATE PASSED, 20/20, 0 rows left behind.**
  - **One probe was wrong and was corrected, not the code.** 10.2 originally asserted the planner *chooses* `Booking_reminder_due`. On a 25-row table it chooses a sequential scan and is right to. B7's gate had already solved this: force the index (`enable_seqscan = off`) to assert the property of the **index**, then *observe* what the planner picks at this size. Forced plan: `Bitmap Index Scan on "Booking_reminder_due"` with both range bounds in the `Index Cond`.
  - One finding recorded as OBSERVED rather than fixed: a booking whose shop has no `BusinessProfile` is **claimed and then dropped**, because the claim precedes the projection that discovers the missing slug. Unreachable today — the slug *is* the profile — and named in case it stops being.
- [x] 10.3 Fire the scheduled trigger by hand: `npx wrangler dev -c wrangler.cron.jsonc --test-scheduled`, invoke the reminder schedule, and confirm the summary is emitted.
  - **This step caught a defect that nothing else could, and it is the reason the step exists.** The first entrypoint exported `SWEEP_CRON`, `REMINDER_CRON` and `buildReminderService` alongside the default so tests could import them. Every unit test passed, `tsc --noEmit` passed, the bundle built — and **the Worker would not start**: workerd treats every *named* export of an entrypoint as a service-export-map entry and refuses one that is not a handler (`Incorrect type for map entry 'REMINDER_CRON'`). Split into `worker/jobs.ts` + a three-line `worker/scheduled.ts`, and a test now asserts `Object.keys(entrypoint)` is exactly `['default']` — against the module's runtime exports, not its source text, because a source scan cannot tell an export from the word "export" in a comment.
  - **A second defect, found by reading the real log rather than by a test.** The catch block attributed failures with a two-way ternary defaulting to the sweep, so an unrecognised cron — a *configuration* fault — filed itself under `booking.sweepExpiredHolds`. That is the C2 mislabel in a new place. Now three-way, with `worker.scheduled` for a schedule that belongs to no job, and a test holds it.
  - All three paths verified on the real runtime: sweep `candidatesScanned=0` under its own operation; reminder `sent=0 claimed=0` under `email.bookingReminder`; unknown cron → named error and HTTP 500. `originMissing` fired locally and correctly — `.dev.vars` sets `APP_ORIGIN=http://localhost:8787` and `isPubliclyRoutableHost` refuses it, which is the B5 lesson doing its job.
  - The `preview:cron` script already carried `--test-scheduled`, so the flag cannot be forgotten. Nothing to commit.
- [x] 10.4 Full suite, typecheck and lint green. — **3953 tests / 213 files**, all passing (N2 adds 86 tests across 6 files). `tsc --noEmit` clean. `eslint` clean. Coverage **98.03% statements / 95.23% branches** against a 90% threshold.

## 11. Deploy, in the order that keeps every step reversible

> **Franco's, not Claude's.** Deploy, external accounts and DNS stay with Franco; everything above
> this section — runtime checks, gates and migrations — was run here. `wrangler.cron.jsonc` is left in
> the state step 1 expects: `APP_ORIGIN` set, `EMAIL_FROM` absent, and **the reminder's cron
> deliberately not in `triggers.crons`**, with the three-step order written in the file itself.

- [x] 11.1 Deploy the cron Worker with no reminder cron expression. The job is unreachable code; the deploy proves the bundle. — Deployed 2026-08-30, version `468ebbdd-c3f2-4d3c-aa9e-2eeccc283e32`. **914.02 KiB gzip against a 913.54 dry-run** — Cloudflare measures slightly larger than the tool prints, which is B2/T51 standing. `schedule: */5 * * * *` only; the reminder is unreachable. `GET /` answers `1101` (no `fetch` handler), so no stranger can reach either job.
- [x] 11.2 Set `APP_ORIGIN` and `EMAIL_FROM` on the cron Worker. **Leave `RESEND_API_KEY` unset**, per T76. `APP_ORIGIN` is already committed in `vars`; `EMAIL_FROM` stays absent until a domain is verified.
  - Satisfied by 11.1's deploy: `APP_ORIGIN` rode in from the committed `vars` and is reported in the Worker's bindings. `EMAIL_FROM` is **deliberately absent** and `wrangler secret list` confirms the only secret is `DATABASE_URL` — so the reminder's configuration guard is armed exactly as intended, and the job would refuse to claim anything even if its schedule existed.
  - **This step's original wording was false and the adversarial pass caught it.** It said the job "runs, claims nothing, and names the missing variable, which is a handled state". It did not claim nothing — the claim precedes the send, so an unconfigured deployment would have claimed every due booking and delivered none of them, permanently, on the very first run this plan asks for. `runReminders` now checks the configuration before it queries anything, logs the missing variables once, emits a zero summary, and returns without touching the database. The sentence is true now because of that guard rather than in spite of it.
- [ ] 11.3 Add `"0 * * * *"` to `triggers.crons` and deploy. This is the only irreversible step and it is one line; the rollback is removing it.
- [ ] 11.4 Confirm the schedule is registered on the deployed Worker and that the first invocation emits a summary under `email.bookingReminder`. — **Open, and cannot be closed until 11.3 exists.** Half of it is proven: the sweep's schedule is registered and firing under the new dispatch (below). The reminder's is not, because it deliberately has no cron yet.
  - **The sweep survived the entrypoint rewrite, verified in production** rather than inferred. `wrangler tail` on version `468ebbdd` caught a real scheduled invocation at 00:45:27Z: `{"cron":"*/5 * * * *"}` → `Expired hold sweep complete`, `candidatesScanned: 0`, `durationMs: 2139`, outcome `ok`. That is B7 running through `runScheduledJob`'s dispatch, unchanged, on the live database.
  - **The absent `fetch` handler is proven by the platform's own error**, not just by reading the file. A `GET /` against the Worker's URL produced `outcome: "exception"` with `Handler does not export a fetch() function.` — the spec requirement that no stranger can reach either job, evidenced by the runtime refusing them.
  - **No `email.bookingReminder` line appeared, which is correct**: with no cron registered the job is unreachable code. Its first production line will arrive only after 11.3, and — with `RESEND_API_KEY` unset per T76 — it will be the configuration refusal, not a send.

## 12. Documentation and debt, in the same change

- [x] 12.1 Tick N2 in `docs/roadmap.md` and add its entry — including the correction that its dependency line implied a reuse of N1's idempotency that does not exist. — The dependency line itself is rewritten, not just annotated: it now names the `reserva-barber-cron` Worker rather than "the Cron Trigger".
- [x] 12.2 Extend **T76** to a second message, stating that a reminder is worse placed than a confirmation: a failed reminder has no user-visible surface at all, so its failure and its success are byte-identical to a client. — Also records that closing it now closes **three** messages, and that `EMAIL_FROM` and the key must be set on **both** Workers because there is no shared secret store.
- [x] 12.3 Re-cost **T71**: reminders roughly double volume and arrive as a burst, so the likely shape is reminders exhausting the quota and confirmations behind them being throttled. — Reframed: the failure is no longer "confirmations stop" but "reminders starve confirmations". `ReminderSummary.outcomes` now gives a `throttled` count a denominator for the first time.
- [x] 12.4 Open a new entry for whichever of the lead, the minimum gap or the missing retry remains a guess, each with the trigger that brings it back. — **T85** (the two constants) and **T86** (no retry, and nothing looking at the failure). T85 records that the minimum gap is *not* a product opinion and should be re-derived rather than re-guessed if the window shape changes; T86 records why un-claiming is worse than losing one message.
- [x] 12.5 Note in **T56** that guest personal data now reaches a third place. — A **fourth**, and the first written without the client having done anything: the reminder is sent by a clock. Also records that an anonymising write must stop the reminder, which it does for free.

## 13. Adversarial review, and the six findings it produced

> Run in the same session that implemented the change, which is **not** how the skill is meant to be
> used — the reviewer's blind spot was the author's. Two findings were nonetheless blockers, and one
> of my own findings turned out to be wrong about its own mechanism.

- [x] 13.1 **BLOCKER — an unconfigured deployment claimed every due booking and delivered nothing.** The claim precedes the send, so `UnconfiguredEmailSender` answering `rejected` per booking left every row permanently marked as reminded. Not hypothetical: T76 **requires** `RESEND_API_KEY` to be absent in production, so the first scheduled run this plan asks for would have consumed every reminder the shop had.
  - Fixed at the composition root, not in the service: `missingEmailConfiguration()` is now its own export, `buildReminderService` returns what is missing, and `runReminders` logs the names, emits a zero summary and returns **before issuing any query**. The refusal is not an invocation failure — it is the state the deployment was told to be in.
  - Proven on the real runtime with the key removed from `.dev.vars`: HTTP 200, both variables named, `skipped: "notConfigured"`, and the database confirms **0 of 2** future confirmed bookings claimed.
- [x] 13.2 **BLOCKER — two documents asserted the opposite of what the code did.** `tasks.md` 11.2 and `wrangler.cron.jsonc` both said an unconfigured job "claims nothing". Both rewritten to say what is now true and why it had to be made true.
- [x] 13.3 **MAJOR — the copy said "Tu turno es mañana" and could not know that.** The candidate window's near edge is deliberately open, so a booking due in ninety minutes is still reminded — and was being told it was tomorrow. The intro no longer names a day; the date lives only in the "Cuándo" row, computed from `startTime`. Two tests hold it, one of them scanning the copy strings for any day-word.
- [x] 13.4 **MAJOR, downgraded to MINOR by measurement — a builder throw aborted the whole batch.** The finding's property was right and its mechanism was wrong: malformed money does **not** throw (`toCents` returns `NaN`, the balance comparison is false, the line is omitted). What throws is an unrenderable instant — `Intl` answers `RangeError` — which is not reachable through a `Timestamptz` column today. The per-message `try` is kept anyway: it costs one `catch`, and "one bad row must not consume a batch" should not depend on the builder staying total.
- [x] 13.5 **MINOR — T57 violated in my own code.** `buildReminderService(env, logger, db = {} as PrismaClient)` put a test-convenience default on a production composition root, which is exactly the hole T57 records and which `emailSenderFactory.ts` invokes as a rule two files away. `db` is now required; the tests pass their own stub, and `runScheduledJob` takes an injectable client **factory** instead — a factory has no shape that silently half-works.
- [x] 13.6 **MINOR — spec drift.** The profile-less drop and the batch-isolation rule existed in code and in the gate but in no requirement. Both are now in `booking-reminder-email`, along with the configuration refusal from 13.1, as one new requirement and three new scenarios.
