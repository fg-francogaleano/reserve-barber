## Why

Every booking in this product is confirmed by a deposit, and one of the two ways to pay it is a bank transfer. Nothing in the system yet records where that transfer should go. Until it does, B6 has nothing to display and the transfer half of the payment story cannot be built.

It is also the first write to `PaymentConfig`, the one row that PC2 and PC3 will later share. Deciding here how that row is created, which columns a partial configuration may touch, and what the public flow is allowed to read out of it settles three questions that would otherwise be answered inconsistently by three stories.

The data model has two gaps this change has to close before any code is written. §14 declares `depositValue` **required**, but the row must exist the moment transfer details are saved and no deposit policy is chosen until PC3. And it declares `transferHolderName` optional, when a CBU with no holder name is unusable — a client transferring to a bare 22-digit number cannot confirm they are paying the right business.

## What Changes

- Add the `PaymentConfig` model and the `add_payment_config` migration, **including the PC2 and PC3 columns**. A single-row entity split across three migrations drifts; two unused columns for a few days do not.
- **`data-model.md` §14 is amended first, not after.** `depositValue` becomes nullable until PC3 sets it, and the holder name gains an explicit conditional requirement. Per `base-standards.md` §7 the spec moves before the code.
- Add a transfer-details editor at `/transferencia`: the owner saves a CBU/CVU, an alias, or both, plus the account holder name.
- **The section has three valid states, not two.** All fields empty means transfer is not offered — a legitimate choice for an owner using Mercado Pago only. Configured means a holder name plus at least one destination. Anything else is rejected. Clearing a configured transfer back to empty is allowed even when it leaves no payment method at all: blocking it would trap an owner migrating from transfer to Mercado Pago. The gate that stops an unbookable business belongs to the booking flow, not to this form.
- **The CBU check digits are verified, not just the length.** A single transposed digit passes a length check and routes every client's deposit to a stranger's account, and nobody finds out until the owner asks where the money is. This is the only irreversible error in the story.
- **Changing an already-saved destination requires an explicit confirmation step.** The alias namespace has no checksum — `mi.barberia` and `mi.barberia1` are both valid and may belong to different people. No validation can catch that, so the owner confirms the normalized value once, and only when it actually changed.
- Values are stored normalized — CBU as digits only, alias trimmed and lowercased — and rendered back from the database, formatted, so the owner verifies what was stored rather than what they typed.
- The write is a single `upsert` keyed on `ownerId` that touches **only the three transfer columns**, so it can never clobber PC2's credentials or PC3's policy, and a retry after a committed-but-timed-out save is a no-op rather than a duplicate.
- The public flow reads transfer details through a **narrow projection**, never the whole row. `mpAccessToken` lives in the same record; a projection that does not carry it cannot leak it.

## Capabilities

### New Capabilities
- `payment-transfer-details`: the owner records, edits and clears the bank transfer destination — the three states of the section, the CBU and alias validation rules, the normalization, the confirmation on change, the conditional requirement on the holder name, and the Spanish (es-AR) states of the form.

### Modified Capabilities
- `data-persistence`: the `PaymentConfig` model as single source of truth, the singleton-per-owner row and its `upsert` lifecycle, the column-scoped partial write that keeps PC1/PC2/PC3 from overwriting each other, and the narrow projection that keeps the Mercado Pago access token out of the public flow.

## Impact

**Docs** — `docs/data-model.md` §14 amended before implementation (nullable `depositValue`, conditional holder name, the bookability gate stated as an application rule rather than a column constraint). `docs/roadmap.md` PC1 ticked on completion. `docs/tech-debt.md` gains the deferred audit table and the last-write-wins concurrency note.

**Schema** — new `PaymentConfig` model, new `DepositType` enum, migration `add_payment_config`; back-relation on `Owner`; both Prisma clients regenerated. Purely additive.

**Server layers** — new `IPaymentConfigRepository`, `PrismaPaymentConfigRepository`, `PaymentConfigService`, `transferDetailsSchema`, `PaymentConfigErrors`, and a dependency-free `cbu` module holding the normalizers and the check-digit algorithm.

**Presentation** — new route `app/(dashboard)/transferencia/`; modifications to `app/(dashboard)/layout.tsx` (nav link) and `src/lib/copy.ts`.

**Runtime risk** — low. No new infrastructure, no external API, one row, one statement. The only genuinely new logic is the check-digit algorithm, which is pure arithmetic and therefore runtime-agnostic; it is gated by fixtures from real accounts at more than one bank, because a wrong weight table rejects valid CBUs, which is a worse failure than the one it prevents.

**Downstream** — unblocks B6 (transfer payment step) and is one of the two inputs to PC3's precondition. PC2 inherits the row lifecycle decided here.

**Not affected** — Mercado Pago credentials, deposit policy, receipt upload and review, the booking flow itself, and every catalogue story in Phase 1a.
