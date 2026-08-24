## 1. Source-of-truth documents first (`base-standards.md` §7)

- [x] 1.1 `docs/data-model.md` §11: record that `EXPIRED` is now written by a scheduled sweep, that a `PENDING_PAYMENT` row is eligible only `EXPIRY_GRACE_MINUTES` after `holdExpiresAt`, that `PENDING_APPROVAL` is eligible only once `startTime` has passed, and that an expired row keeps `holdExpiresAt` while `cancelledAt`/`cancelledBy` stay null.
- [x] 1.2 `docs/backend-standards.md` Booking rule 2: replace "a scheduled job expires stale holds" with the grace window, the batching and the guarded-update rule; rule 4: state that the sweeper is the job that acts on the `PENDING_APPROVAL` exception, and that it takes no advisory lock.
- [x] 1.3 `docs/backend-standards.md` §Deployment: record that a scheduled job is its own Worker (with the measurement that forced it) and that a scheduled invocation receives bindings by argument rather than through the process environment.

## 2. The constant

- [x] 2.1 Add `EXPIRY_GRACE_MINUTES = 10` to `src/server/domain/models/bookingHorizon.ts`, documented in the register of the other four constants: what it protects (`confirmIfSlotFree`'s `PENDING_PAYMENT` guard), why it costs nothing, and that it is a judgement no shop has measured.
- [x] 2.2 Extend `bookingHorizon`'s coverage in `Booking.test.ts` (or a sibling) with the eligibility arithmetic: a hold lapsed inside the grace is not eligible, one lapsed past it is, and the boundary instant itself is decided one way and stated.

## 3. The port

- [x] 3.1 Create `src/server/domain/repositories/IExpiredHoldRepository.ts` with the candidate projection (`id`, `status`, `startTime`, `endTime`, `holdExpiresAt`), a candidate read per rule taking the run's instant and a limit, a guarded bulk-expire keyed by ids and expected status, and a read of `APPROVED` payments over a set of expired ids.
- [x] 3.2 Document in that file, in the contract itself, that this is the **second** deliberate exception to owner scoping after `findByPublicSlug`, why a sweep cannot be owner-scoped, and what bounds it instead (projection, limit, one column to one value).

## 4. The application service (TDD)

- [x] 4.1 Write failing tests for `ExpiredHoldSweepService`: a lapsed hold inside the grace is not swept; the same hold past the grace is; a `PENDING_APPROVAL` booking before its `startTime` is not; the same after it is; `CONFIRMED`, `CANCELLED` and `EXPIRED` candidates are never selected.
- [x] 4.2 Write failing tests for the mechanics: batching stops on an empty batch, respects the per-run cap, and leaves a remainder; a guarded update matching zero rows is counted as not-swept rather than as an error; a second run over the same rows sweeps nothing.
- [x] 4.3 Write failing tests for the cross-owner property using a **two-owner fixture**: only the eligible owner's booking is expired.
- [x] 4.4 Write failing tests for the observability contract: a run with nothing to do still emits one summary; an expired booking carrying an `APPROVED` payment emits an error naming booking, payment and amount; an absent connection string is reported as an error rather than as an empty run.
- [x] 4.5 Implement `src/server/application/services/ExpiredHoldSweepService.ts` — two independent loops, one instant taken at the start and passed down, `blocksAvailability` making every eligibility decision, `SWEEP_BATCH_SIZE` and `MAX_BATCHES_PER_RULE` declared beside it with their reasons.
- [x] 4.6 Verify no SQL-shaped copy of the blocking rule exists anywhere in the service, and that the service never touches `Payment`, `cancelledAt`, `cancelledBy` or `holdExpiresAt`.

## 5. The repository (TDD)

- [x] 5.1 Write failing tests for `PrismaExpiredHoldRepository`: the candidate query carries the status filter, the instant bound and the limit; the update is guarded on the expected status; the payment read is keyed on the ids actually expired.
- [x] 5.2 Implement `src/server/infrastructure/prisma/PrismaExpiredHoldRepository.ts` — one statement per batch, no `$transaction`, no advisory lock, and a comment recording why each of those is correct here and wrong for the booking write.

## 6. The migration

- [x] 6.1 Create `prisma/migrations/<timestamp>_b7_expired_hold_indexes/migration.sql` with both partial indexes, each carrying the predicate it serves in a comment.
- [x] 6.2 Replace the "rejected as premature" note on `Booking` in `prisma/schema.prisma` with a pointer to the migration, in the form the hold constraint and the one-live-payment index already use.
- [x] 6.3 Apply the migration and confirm with `EXPLAIN` that both sweep predicates use their index rather than a sequential scan.

## 7. The scheduled Worker

> **Revised after measurement.** 7.1–7.4 originally built a committed entrypoint wrapping OpenNext's generated worker (design D1, option A). It worked, and `wrangler deploy --dry-run` put it at **3812.20 KiB gzip against a 3072 KiB ceiling**: anything such an entrypoint imports from `src/` is compiled by wrangler's own esbuild pass, so the Prisma query compiler shipped twice. The measurement and the pivot are recorded in D1; the tasks below are what was actually built.

- [x] 7.1 Split `createPrismaClient` out of `src/server/infrastructure/prisma/client.ts` into `createClient.ts`, so a Worker with no React can build a client without importing `cache()`. `client.ts` re-exports it; no call site changes.
- [x] 7.2 Create `worker/sweep.ts` — `scheduled` only, no `fetch`, composing the sweep from `env.DATABASE_URL` via `createPrismaClient` and throwing a named error when the binding is absent. Relative imports, not `@/`, since wrangler compiles it outside Next's resolver.
- [x] 7.3 Create `wrangler.cron.jsonc` — `reserva-barber-cron`, the app's compatibility date and flags, observability on, `"crons": ["*/5 * * * *"]`, and a header recording why it is a second Worker.
- [x] 7.4 Restore `wrangler.jsonc` to `main: .open-next/worker.js` with no `alias` and no `triggers`, leaving a comment that says where the schedule went and why.
- [x] 7.5 Add `deploy:cron` and `preview:cron` scripts, the latter carrying `--test-scheduled` so the flag cannot be forgotten.
- [x] 7.6 Measure both Workers with `wrangler deploy --dry-run`: app **2924.14 KiB** gzip (B6's number, restored), cron **878.62 KiB**. Confirm `npm run typecheck` and `npm run lint` are clean.

## 8. The live-database gate

- [x] 8.1 Write `scripts/b7-gate.ts` following the `b6-gate.ts` shape: a `__b7_gate__` prefix, cleanup in foreign-key order, and a header stating what only the live database can prove.
- [x] 8.2 Probes for the eligibility rules: a `PENDING_PAYMENT` hold lapsed inside the grace is not swept; the same past the grace is; a `PENDING_APPROVAL` booking before `startTime` is not; the same after it is; a `CONFIRMED` booking is untouched.
- [x] 8.3 Probes for the invariants: a second owner's rows are untouched; a re-run sweeps nothing; a row whose status changed between the read and the write matches zero rows; an expired row keeps its `holdExpiresAt` and its `Payment`, with `cancelledAt`/`cancelledBy` still null.
- [x] 8.4 Run the gate against the live database until it passes, and record the run in the change. **Passed** after one revision to probe 7, which had asserted a planner *decision* rather than the thing under test.

## 9. Verification Franco runs

- [x] 9.1 The local scheduled fire: `npm run preview:cron`, then `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"`, expecting one summary line **in the wrangler console** (the HTTP response carries nothing useful). The script carries `--test-scheduled` because **its absence is not obvious**: without it `/__scheduled` is an ordinary path, and against the app Worker the route guard redirected it to `/login` and answered `200` with a page — a green-looking result that fired no handler at all. That happened twice before it was noticed.
- [x] 9.2 Set the cron Worker's own secret with **`npx wrangler secret bulk secret.json -c wrangler.cron.jsonc`**, never the interactive prompt. Two production runs twenty minutes apart threw `Missing required environment variable: DATABASE_URL` while `secret list` reported the secret present — `list` shows the name and never the value, and the guard reads `!value`, which an empty string satisfies exactly as `undefined` does. The same 112-character string uploaded from a JSON file worked on the next run. Write the file as UTF-8 **without a BOM** (PowerShell 5.1's `Set-Content -Encoding utf8` adds one) and delete it after.
- [x] 9.3 Deploy both: `npm run deploy; if ($?) { npm run deploy:cron }` (PowerShell has no `&&`), then confirm the schedule is registered on `reserva-barber-cron` and the first production summary line appears. **Confirmed 2026-08-24**: two consecutive fires at 9:30:02 and 9:35:02 answered `Ok`, each emitting one summary — `candidatesScanned: 0`, `durationMs` ~2900, which is two cold pooler round trips and no work to do, exactly what an empty run should look like.

## 10. Debt and closeout

- [x] 10.1 `docs/tech-debt.md` T51: record this change's measured size and headroom, and restate the recommendation to take Workers Paid before N1.
- [x] 10.2 `docs/tech-debt.md` T64: record which half closes here — the `startTime` exit is now executed — and that the painful half (a receipt unanswered for weeks on a future appointment) is untouched and still waits on D1 or N1.
- [x] 10.3 `docs/tech-debt.md` T53: add `EXPIRY_GRACE_MINUTES` as the fifth guessed constant, with what would let a real shop measure it.
- [x] 10.4 Open a debt entry for what this change deliberately leaves undone: nothing tells the owner a hold expired, and the sweep's only instrument is a log line.
- [x] 10.5 Tick B7 in `docs/roadmap.md` with the notes this change earned, in the form the other stories use.
- [x] 10.6 Full check before archive: `npm run typecheck`, `npm run lint`, `npm test`, coverage ≥ 90% on domain and application layers, `openspec validate b7-automatic-hold-expiration`.
