## 1. Amend the specification first

- [x] 1.1 Amend `docs/data-model.md` §14: make `depositValue` nullable until PC3 sets it, with the reason stated
- [x] 1.2 Amend `docs/data-model.md` §14: state the conditional requirement that `transferHolderName` is required whenever a destination is present
- [x] 1.3 Amend `docs/data-model.md` §14: restate "at least one payment method configured" as an application gate at the entry to the booking flow, not a column constraint, and note that it now also requires a non-null `depositValue`

## 2. Gate the check-digit algorithm before anything depends on it

- [x] 2.1 Collect CBU fixtures and record their provenance in the test file — one independently published, hand-verified CBU plus two real institutional prefixes (Banco Nación, Mercado Pago CVU). **Amended:** real account numbers are NOT committed; see 2.4
- [x] 2.2 Write tests for `checkCbu` against those fixtures, including a transposed-digit variant of each
- [x] 2.3 Implement `src/server/domain/models/cbu.ts` — `normalizeCbu`, `checkCbu` (both check digits, design D2), `normalizeAlias`, `checkAlias`, `formatCbu`, `cbuLastFour`. Zero dependencies
- [x] 2.4 **Closed (2026-08-13).** Verified against three real values from three issuer families: the published CBU (entity 285), a real Mercado Pago CVU (entity 000) and a real bank CBU (entity 384). All three accepted; each check digit re-derived by hand. Both owner-supplied values landed on the `sum mod 10 === 0` edge case, where a naive `10 - (sum % 10)` returns 10 — the outer modulo is load-bearing and is now covered by real data. No D2 fallback needed. The owner-supplied numbers are deliberately NOT committed
- [x] 2.5 Add boundary tests: 21 and 23 digits, non-numeric input, separators and trailing newline, alias at 6 and 20 characters, alias at 5 and 21, alias with disallowed characters, alias bounded by `.` or `-`, mixed-case alias

## 3. Domain layer

- [x] 3.1 Add `src/server/domain/models/PaymentConfig.ts` — the entity type plus the narrow `TransferDetails` type the public projection returns (design D7), and the `isBookable` gate
- [x] 3.2 Add `src/server/domain/models/holderName.ts`. **Amended:** delegates to the existing `normalizeName` (NFC, not NFKC) rather than adding a second normalization rule; the whitelist is the new part
- [x] 3.3 Add `src/server/domain/errors/PaymentConfigErrors.ts`
- [x] 3.4 Add `src/server/domain/repositories/IPaymentConfigRepository.ts` — `findByOwner`, `findTransferDetailsForPublic`, `upsertTransferDetails`

## 4. Schema and migration

- [x] 4.1 Add the `PaymentConfig` model and `DepositType` enum to `prisma/schema.prisma`, all columns including PC2's and PC3's (design D1), with `depositValue` nullable at `Decimal(12, 2)`
- [x] 4.2 Add the `paymentConfig` back-relation on `Owner`
- [x] 4.3 Run `npx prisma migrate dev --name add_payment_config` → `20260813105556_add_payment_config`. **Required rebasing the branch onto `origin/main` first:** it was cut from the already-merged `feat/m5b-barber-time-off`, so P1's migration was applied to the shared database but absent locally, and Prisma's remedy for that drift is a full reset
- [x] 4.4 Regenerate both Prisma clients — `migrate dev` did **not** run generate; it needed an explicit `npx prisma generate`
- [x] 4.5 Verify the migration is additive and creates no rows — `CREATE TYPE`, `CREATE TABLE`, unique index, FK. No `ALTER` on an existing table, no `INSERT`, no backfill

## 5. Application layer

- [x] 5.1 Add `src/server/application/paymentConfig/transferDetailsSchema.ts` returning error **codes**, never Spanish strings. Follows the house hand-rolled parser shape (`{ ok, data } | { ok: false, fieldErrors }`), not Zod — that is what every existing schema module does
- [x] 5.2 Test the schema across the three states: all-empty accepted, destination-without-holder rejected, holder-without-destination rejected, both destinations accepted
- [x] 5.3 Add `PaymentConfigService.getConfig`, `getTransferDetailsForPublic` and `saveTransferDetails`, depending on the repository interface only
- [x] 5.4 Implement the change-detection that returns a confirmation state when a stored destination would change, and skips it on first configuration and on holder-name-only edits (design D14). **Clearing a stored destination also requires confirmation** — it is the most consequential change of all
- [x] 5.5 Implement the bounded single retry on a `P2002` over `ownerId` (design D12), with tests proving the second failure surfaces and an unrelated failure is not retried
- [x] 5.6 Test that neither `mpAccessToken` nor `depositValue` appears in either upsert branch (design D5)

## 6. Infrastructure layer

- [x] 6.1 Add `PrismaPaymentConfigRepository` with the `upsert` keyed on `ownerId`, naming only the three transfer columns
- [x] 6.2 Implement `findTransferDetailsForPublic` as a narrow `select` and test that the returned object carries no Mercado Pago field (design D7). The dashboard read also reduces `mpAccessToken` to a boolean at the boundary, so its value never travels above the repository
- [x] 6.3 Test that every query carries the owner predicate
- [x] 6.4 Normalization round trip covered by `transferDetailsSchema.test.ts` (`should_store_the_destination_normalized_not_as_typed`) — normalization happens in the schema; the repository writes what it is given. A true database round trip belongs to the manual pass in 10.3

## 7. Copy

- [x] 7.1 Add the `COPY.transfer` block to `src/lib/copy.ts` — labels, help text, nav, the confirmation prompt, the no-method warning, the reload instruction, and one distinct message per rejection code
- [x] 7.2 Confirm no Spanish literal exists in any component, action or schema

## 8. Presentation layer

- [x] 8.1 Add `app/(dashboard)/transferencia/formState.ts` mapping error codes to copy, plus the `values` echo and the confirmation state
- [x] 8.2 Add `actions.ts` with `saveTransferDetailsAction` — `requireOwner()` as the first line, no redirect on success, `revalidatePath` on write
- [x] 8.3 Return infrastructure failures as form state with the reload instruction and preserved values (design D13); never throw
- [x] 8.4 Add the success-path structured log with previous and new CBU last-four, and confirm no full destination or holder name is logged (design D9)
- [x] 8.5 Add `page.tsx` — Server Component, `export const dynamic = 'force-dynamic'` (design D11), renders stored values from the database with the CBU grouped in fours
- [x] 8.6 Add `TransferDetailsForm.tsx` — `useActionState` + `useFormStatus`, uncontrolled inputs, `type="text"` with `inputMode="numeric"` on the destination, no `min`/`max`/`step`/`pattern`
- [x] 8.7 Render the confirmation state as a form state, not a dialog, with confirm and back-to-edit controls
- [x] 8.8 Render the server-produced no-method warning alongside the success state, not instead of it (design D16)
- [x] 8.9 Wire field errors with `aria-invalid` and `aria-describedby`; disable submit while pending
- [x] 8.10 Add `loading.tsx` with a three-field skeleton
- [x] 8.11 Add the `Transferencia` nav link to `app/(dashboard)/layout.tsx`

## 9. Presentation tests

- [x] 9.1 Action tests: `requireOwner` precedes parsing; validation failure echoes values without calling the service; success revalidates; infrastructure failure returns the generic message and logs without the destination
- [x] 9.2 Action test: the confirmation path does not persist on first submission and does persist on confirm
- [x] 9.3 Page tests: empty state renders blank; configured state renders the grouped CBU read from the database
- [x] 9.4 Form tests: errors render against their field; submit disabled while pending; the warning appears only when the save left no method configured

## 10. Verification

- [x] 10.1 `npm test` green; coverage ≥ 90% on domain and application layers
- [x] 10.2 `npm run typecheck` and `npm run lint` clean
- [x] 10.3 Verified on the Workers runtime by the owner: authenticated save on the OpenNext preview (:8787), values persisted and re-rendered from the database
- [x] 10.4 Driven in the browser by the owner: unconfigured → configured (real CVU accepted), configured → edited (**confirmation screen appeared and was required**), stored values re-rendered from the database after reload. The configured → cleared path is covered by unit tests but was not driven manually
- [x] 10.5 Deferred to `docs/tech-debt.md` T37 — the no-JavaScript path is satisfied by construction but was never driven; the confirmation round trip is the part worth checking

## 11. Close out

- [x] 11.1 Record in `docs/tech-debt.md`: the deferred `PaymentConfigAudit` table (trigger: first report of a deposit that did not arrive) and last-write-wins across tabs (trigger: a second administrative user)
- [x] 11.2 Not applicable — the D2 fallback was not taken; the weight tables verified against real accounts (see 2.4)
- [x] 11.3 Tick PC1 in `docs/roadmap.md`
- [x] 11.4 Run `/opsx:verify`, then archive the change
