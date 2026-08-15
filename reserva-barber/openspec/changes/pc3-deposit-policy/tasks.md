## 1. Documentation first (base-standards §7)

- [x] 1.1 Amend `docs/data-model.md` §14: whole-number percentage range 1–100, `FIXED` bounded by `MAX_PRICE`, half-up rounding to two decimals, the price cap, the `MIN_DEPOSIT_AMOUNT` floor and its guard for services priced below it, and the removal semantics (empty value is invalid; removal is an explicit intent)
- [x] 1.2 Amend `docs/data-model.md` §11: `Booking.depositAmount` is computed once at creation and never recomputed; a policy change alters no existing booking, and payment validation compares against the recorded amount
- [x] 1.3 Confirm no schema change is required against `prisma/schema.prisma:328-337` and record that in the change notes

## 2. Shared money module (design D11 — first, so a regression surfaces before anything is built on it)

- [x] 2.1 Write failing tests for `src/server/domain/models/money.ts`: accepts `8000`, `8000.50`, `8000,50`; rejects exponent notation, infinity, signed values, non-ASCII digits, thousands grouping (`8.000,50`, `4.500`), and more than two decimal places
- [x] 2.2 Implement `money.ts` — parser, canonical two-decimal string output, es-AR formatter, and `MAX_PRICE` as the single declaration of the catalogue ceiling
- [x] 2.3 Refactor `src/server/application/servicesCatalog/serviceSchema.ts` onto `money.ts`, removing its local copies of the parsing regexes and `MAX_PRICE`
- [x] 2.4 Verify the existing `serviceSchema.test.ts` passes **unmodified** — this is the verification of the refactor; if a test needs editing, the refactor changed behaviour

## 3. Domain — the deposit policy value object

- [x] 3.1 Write failing tests for `src/server/domain/models/depositPolicy.ts` covering the ordered rule: 30% of 2501.67 → 750.50; `FIXED` 5000 against a 3000 service → 3000.00; a computed 0.50 against a service above the floor → `MIN_DEPOSIT_AMOUNT`; a service priced below the floor → the service price, not the floor
- [x] 3.2 Implement `depositPolicy.ts` — `DepositPolicy` value object and `computeDepositAmount`, using integer-cent arithmetic over string/`Decimal` values with no floating-point intermediate
- [x] 3.3 Declare `MIN_DEPOSIT_AMOUNT` once in `depositPolicy.ts`, documented as provisional with B5 named as the point of confirmation (design D12)
- [x] 3.4 Add `DepositPolicy` / `DepositPolicyInput` types, `hasDepositConfigured()` and `PaymentReadiness` to `src/server/domain/models/PaymentConfig.ts`
- [x] 3.5 Implement `isBookable()` in `PaymentConfig.ts` and replace the stale comment at lines 36-37 and the deferral note at lines 121-134, which explained its absence for want of a caller

## 4. Application — validation

- [x] 4.1 Write failing tests for `src/server/application/paymentConfig/depositPolicySchema.ts`: missing type rejected; unrecognized type rejected; `PERCENT` fractional, 0 and 101 rejected; `PERCENT` 100 accepted; `FIXED` 0 and above `MAX_PRICE` rejected; empty value rejected as required; a distinct code per mistake
- [x] 4.2 Implement `depositPolicySchema.ts` returning error codes, never Spanish strings, reusing `money.ts` for the value and never falling back to the column default for the type (design D5)

## 5. Persistence

- [x] 5.1 Add `upsertDepositPolicy(ownerId, policy)` and `findDepositPolicyForPublic(ownerId)` to `src/server/domain/repositories/IPaymentConfigRepository.ts`, documenting the column-scoping obligation on the write and the narrowness of the projection
- [x] 5.2 Write failing tests in `PrismaPaymentConfigRepository.deposit.test.ts`: the update names only `depositType` and `depositValue`; the create branch leaves the transfer and Mercado Pago columns null; a row holding both other configurations is unchanged by a deposit write; removal nulls only `depositValue`
- [x] 5.3 Write a failing test that `findDepositPolicyForPublic` selects neither credential column and reports an unconfigured policy rather than substituting a default
- [x] 5.4 Write a failing test that a value written as `8000.50` is read back as the string `8000.50` with no floating-point conversion on either leg
- [x] 5.5 Implement both methods in `PrismaPaymentConfigRepository.ts` with `PUBLIC_DEPOSIT_FIELDS`, and `Decimal` conversion confined to the mapper in both directions

## 6. Application — service layer

- [x] 6.1 Write failing tests in `PaymentConfigService.deposit.test.ts`: first save writes without confirmation; an unchanged re-save writes without confirmation; a differing policy returns `needs_confirmation` and writes nothing; removal of a stored policy requires confirmation; a `P2002` on a first save is retried once and reported as success
- [x] 6.2 Write failing tests for the effect preview: services and their computed deposits; services below a fixed deposit named; services whose computed deposit falls under the floor named; an owner with no services yields an empty list, not an error
- [x] 6.3 Write failing tests for `getPaymentReadiness`: ready with transfer + policy; not ready with a payment method and no policy; not ready with a policy and no payment method; and that the path performs no decryption
- [x] 6.4 Implement `getDepositPolicy`, `saveDepositPolicy`, `removeDepositPolicy` and `getPaymentReadiness` on `PaymentConfigService`, reusing `writeWithSingleRetry` unchanged and computing `leavesNoPaymentMethod` on the server

## 7. Presentation — `/sena`

- [x] 7.1 Add the `deposit` section to `src/lib/copy.ts` in Spanish (es-AR), covering every state, every validation code, the full-prepayment label for 100%, and the two warnings
- [x] 7.2 Create `app/(dashboard)/sena/paymentConfigService.ts` — composition root wiring the repository **without** a cipher, with a comment stating why (design D10)
- [x] 7.3 Create `app/(dashboard)/sena/formState.ts` with the form state shape, including pending confirmation, warnings and readiness
- [x] 7.4 Write failing tests for `app/(dashboard)/sena/actions.ts`, then implement `saveDepositPolicyAction` and `removeDepositPolicyAction` with `requireOwner()` as the first statement, `deposit-*` intents, `revalidatePath('/sena')` and no redirect
- [x] 7.5 Implement the infrastructure-failure path: log with `toErrorLogContext`, return the reload message rather than asserting the save failed
- [x] 7.6 Implement the structured success log line carrying operation, owner id, previous and new type and value, `leavesNoPaymentMethod` and the count of services below the deposit — unredacted (design D13)
- [x] 7.7 Write failing tests for `DepositPolicyForm.tsx`, then implement it: a labelled radio group for the type, the value field with its affix, errors wired through `aria-describedby`, and the normalized es-AR echo after a save
- [x] 7.8 Implement the confirmation step in the form — the effect list rendered from server-computed values, with an empty state for an owner with no services
- [x] 7.9 Write failing tests for `page.tsx`, then implement it with all ten states and the readiness panel, which must not convey state by colour alone
- [x] 7.10 Add `app/(dashboard)/sena/loading.tsx` matching the existing settings editors
- [x] 7.11 Add the "Seña" nav link to `app/(dashboard)/layout.tsx`

## 8. Technical debt closed in this change

- [x] 8.1 Rename the confirmation intents in `app/(dashboard)/transferencia/actions.ts` to `transfer-*` and update its tests and form (T41)
- [x] 8.2 Rename the confirmation intents in `app/(dashboard)/mercado-pago/actions.ts` to `mp-*` and update its tests and form (T41)
- [x] 8.3 Add a test asserting each action reads only its own prefixed intent

## 9. Verification

- [x] 9.1 `npm run lint`, `npm run typecheck` and the full test suite pass
- [ ] 9.2 Drive the running app through all ten states, including the replacement confirmation with its effect list and the empty-catalogue case
- [ ] 9.3 Verify `/sena` renders with `PAYMENT_CREDENTIALS_KEY` unset while Mercado Pago credentials are stored, and that readiness still counts Mercado Pago as configured
- [ ] 9.4 Verify a deposit save against a row holding a transfer destination and Mercado Pago credentials leaves both untouched, read back from the database
- [ ] 9.5 Verify the transfer and Mercado Pago confirmation flows still work after the intent rename

## 10. Documentation closeout

- [ ] 10.1 `docs/tech-debt.md`: close **T41** with what was renamed
- [ ] 10.2 `docs/tech-debt.md`: update **T35** noting the unredacted deposit log line and what it now answers for this field
- [ ] 10.3 `docs/tech-debt.md`: update **T42** with the readiness view PC3 built, and why test-credential detection was left out (design D14)
- [ ] 10.4 `docs/tech-debt.md`: record **T44** as decided for B4, with the reasoning from design D17
- [ ] 10.5 `docs/tech-debt.md`: add an entry for the provisional `MIN_DEPOSIT_AMOUNT`, triggered by B5
- [ ] 10.6 Tick **PC3** in `docs/roadmap.md` with carried-decision notes in the style of the PC1 and PC2 entries
- [ ] 10.7 Run `openspec validate pc3-deposit-policy --strict`
