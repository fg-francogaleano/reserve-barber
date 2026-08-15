## Context

PC3 is the last configuration story before the public booking flow. It writes two columns that already exist — `depositType` and `depositValue` — into the singleton `PaymentConfig` row that PC1 created and PC2 extended. There is no migration, no new secret, and no outbound third-party call. On the infrastructure axis it is the cheapest payment story in the project.

The difficulty is elsewhere. PC1 and PC2 stored values the owner **transcribes** from an authority — a CBU printed by their bank, a token issued by Mercado Pago — so both could lean on something external: a checksum, a verification call, an account name. PC3 stores a value the owner **invents**. `30` and `3` are both valid percentages, `FIXED 50` and `PERCENT 50` are both valid policies, and no authority exists to ask. Every safeguard in this design has to be built out of things the system already knows: the owner's own service prices, the stored policy being replaced, and the type/value pair being internally coherent.

Two constraints carry over unchanged and are treated as settled:

- **The shared row.** Three stories write it; a whole-entity write would silently reset the other two (PC1 design D5, now binding on a third write). `PaymentConfigService.writeWithSingleRetry` already absorbs the `P2002` a first-save race produces, and takes the write as a callback specifically so a second story could reuse it.
- **The narrow projection.** `mpAccessToken` lives in this row; reads serving the public flow select only what they need (PC1 design D7, extended by PC2).

Downstream, B4 computes the deposit at booking creation, B5 charges it, B6 shows it. All three consume what this story defines, which makes the computation rule an interface, not an implementation detail.

## Goals / Non-Goals

**Goals:**

- One authoritative deposit calculation, consumed by B4/B5/B6 and reimplemented nowhere.
- Make an order-of-magnitude mistake visible before it is stored, using the only evidence available: the owner's real service prices.
- Make a nonsensical deposit impossible to charge — larger than the service, or too small for a gateway to accept — regardless of what is configured.
- Answer "can my business take bookings?" in one place, for the first time.
- Leave PC1's and PC2's columns provably untouched.

**Non-Goals:**

- **Per-service or per-location deposits.** `docs/base-standards.md` §4 fixes a single shared payment configuration for this version. This is the only decision in the change that would require a migration, and it is out of scope.
- **Detecting Mercado Pago test credentials** (T42). See D14.
- **Enforcing the bookability gate.** PC3 reports readiness; B4 enforces it at the entry to the booking flow, which is the only place a booking can be refused.
- **Deposit refunds, partial payments, or deposit-free bookings.** Out of scope for the MVP per `docs/base-standards.md` §4.
- **Fixing T44** (form state lost without JavaScript). Decided here, implemented in B4 — see D17.

## Decisions

### D1 — The computation lives in a `DepositPolicy` value object, and the rule is ordered

`backend-standards.md` names `DepositPolicy` as a Value Object and requires the deposit calculation to exist in exactly one place. The rule is stated as an ordered pipeline because each step can undo the previous one and the order is the specification:

```
1. raw   = FIXED ? value : price * value / 100
2. round = half-up, 2 decimals, integer-cent arithmetic over Decimal
3. cap   = min(round, price)
4. floor = price < MIN_DEPOSIT_AMOUNT ? price : max(cap, MIN_DEPOSIT_AMOUNT)
```

Step 4 is guarded rather than a plain `max` because a service priced below the floor would otherwise be charged more than it costs — the cap of step 3 undone by the floor of step 4. That interaction is the reason the two clamps are specified together rather than added independently by whoever meets them first.

*Alternatives considered.* Computing in `BookingFactory` (where `backend-standards.md` says the deposit is applied): rejected — the factory is a **caller**, and the preview in the deposit editor needs the same rule without creating a booking. Two callers is exactly the case a value object exists for.

### D2 — Rounding is half-up over integer cents, never a float

`Number` arithmetic on money is excluded by `data-model.md`'s money convention, and the failure it produces is silent: `2501.67 * 0.3` is `750.5009999999999` in IEEE-754. The computation converts to integer cents, multiplies, and rounds half-up.

*Alternatives considered.* Truncating down — never overcharges, but the amount always lands below the advertised percentage, which is surprising in a value shown to clients. Banker's rounding — statistically fairer over many operations, and unexpected here, where each deposit is read individually by a human.

### D3 — A fixed deposit is capped at the service price, and the warning is not the protection

Cap in the computation **and** warn at save time, and treat them as answering different questions. The warning tells the owner about a mismatch at the moment they can fix it. The cap is what actually protects the client, because the warning is a snapshot of the catalogue: an owner who saves a $5.000 fixed deposit today and adds a $3.000 service next week gets no second warning.

*Alternatives considered.* Blocking the save — traps an owner in the order of editing (they cannot raise the deposit before raising prices) and still does nothing about the service created afterwards. Warning only — leaves a client charged more than the service costs.

### D4 — The percentage is a whole number

1 to 100 inclusive, integers only. The owner chose this over allowing two decimals, which the `Decimal(12, 2)` column would have supported. It makes the input rule narrower and removes a class of typo (`3.0` for `30`) from the space entirely.

`100` is permitted and labelled as full prepayment rather than silently accepted as an ordinary deposit — it is a legitimate model, and it is also what a slipped keystroke produces, so it is named on the confirmation.

### D5 — `depositType` is validated as a submitted value, never defaulted

The column carries a `PERCENT` default (`prisma/schema.prisma:328`), which exists so PC1's create branch could write a row without inventing a policy. If the parser adopted that default for a submission that omitted the type, a `50` meaning fifty pesos would be stored as fifty percent. The two fields are only meaningful as a pair, so an incomplete pair is rejected in full — the same reasoning PC2 applied to the credential pair.

### D6 — The replacement confirmation carries an effect preview, computed on the server

The confirmation shows each existing service with the deposit the submitted policy would charge: `Corte $8.000 → seña $2.400`. This is the whole answer to "no external authority can validate this value" — a `30` typed where `3` was meant passes every check and is obvious the moment it is multiplied by a real price.

Server-rendered, through the same round trip PC1's confirmation uses: it survives without JavaScript, cannot block the runtime, and — critically — computes through the same `DepositPolicy` object the booking flow uses. A client-side live preview was rejected for that reason alone: it would be a second implementation of a money calculation, in the layer least able to be trusted.

### D7 — Confirmation gates replacement only

Not on a first configuration, not on an unchanged re-save. This is PC1's design D14 reasoning applied unchanged: friction on every save is friction that gets clicked through, which would disarm the step in the one case it exists for. Going from no policy to a policy has no previous value to be confused with.

Removal is confirmed, because it is the change that leaves the business unable to take bookings.

### D8 — An empty value is a validation error; removal is a separate intent

PC2 established that removal is an explicit intent rather than the absence of a value, for a field that could never be displayed. PC3's value **is** displayed, so the reasoning has to be made again rather than inherited: this is a single-field form, and if empty meant "clear", one keystroke followed by an ordinary save would leave the business unbookable while looking like a successful edit. The cost is one extra step for an owner who genuinely wants to remove the policy; the benefit is that the destructive path cannot be reached by accident.

### D9 — Readiness is one domain predicate, reported here and enforced in B4

`isBookable` has been referenced in `PaymentConfig.ts` since PC1 and deliberately never written, because implementing a rule with no caller would have implied PC1 enforced something it did not. PC3 is the caller. The predicate is written once in the domain and consumed by the readiness panel; B4 consumes the same predicate at the entry to the booking flow.

Splitting reporting from enforcement is deliberate: a dashboard that refuses to save is not the same control as a booking flow that refuses to book, and only the second one protects a client.

### D10 — The deposit page constructs no cipher

Readiness needs to know whether Mercado Pago is configured. `getMercadoPagoView` answers that by decrypting, and it exists to distinguish a credential that is stored-but-unreadable — a distinction the deposit page does not need. `findByOwner` already reduces the token to `hasMercadoPagoCredentials` at the repository boundary without decrypting, so `/sena`'s composition root wires the repository **without** a cipher, exactly as `/transferencia` does.

The consequence is the point: a missing `PAYMENT_CREDENTIALS_KEY` cannot take down a page about deposit amounts. PC2 validated that secret at its own composition root so a forgotten secret would break one page; a careless import here would quietly widen it to two.

### D11 — The parser is extracted, not copied

`serviceSchema.ts` already decides what an es-AR money string is: which separators group, which decimal counts are refused, which shapes never reach a float. PC3 needs the same decision. Two copies of a money-parsing rule will diverge, and the divergence would be silent — one screen accepting a value the other rejects, or worse, parsing it differently.

The extraction moves the parser to `src/server/domain/models/money.ts` and refactors `serviceSchema` onto it. **The existing `serviceSchema` tests must pass unmodified** — that is the verification that the refactor changed no behaviour, and it is why the extraction goes first in the task order rather than last.

*Alternatives considered.* Duplicating into `depositPolicySchema` — zero risk to a stable file, at the cost of the divergence above. Rejected on the same grounds PC2 generalized `redactDestination` at its second call site.

### D12 — `MIN_DEPOSIT_AMOUNT` ships provisional, and says so

The floor exists because a computed deposit of $0,50 is not chargeable and would fail inside a client's checkout. What the actual minimum is, is a fact about Mercado Pago that this change does not verify. The constant is therefore declared once, documented as provisional, and recorded as an item that closes before B5 — the story that first calls Mercado Pago with real money and is in a position to confirm it.

Writing a number and letting the next story assume it was checked is how an unverified guess becomes an established constant.

### D13 — The policy is logged in full

PC1 and PC2 redact, because a bank destination and a bearer token are respectively sensitive and secret. The deposit policy is neither: it is disclosed to every client who books. Copying the redaction pattern would carry the mechanism without its reason and would throw away the only audit trail this story can produce for free.

The log line carries the previous and new type and value, which partially answers T35's question — "when did this change and to what?" — from the log stream, for this field.

### D14 — Test-credential detection stays out (T42 remains open)

T42's trigger names PC3, and the lead available is that a Mercado Pago test account's nickname reads `TEST_USER_…`. It rests on an undocumented endpoint and has been observed against exactly one account. The readiness panel is precisely what an owner consults before publishing their link, so a false "you are ready" from an unverified signal is worse than the panel saying nothing about credential environment at all.

T42 stays open with the lead recorded and the verification it needs stated: check the marker against more than one test account before building on it.

### D15 — Route `/sena`, label "Seña"

*Seña* is the es-AR term for a booking deposit; *depósito* reads as a bank deposit or a warehouse. ASCII slug, consistent with `/sucursales`, `/servicios`, `/transferencia`.

### D16 — `intent` values are namespaced now, closing T41

`FormData.get` returns the first value for a repeated name. PC1 and PC2 both carry the confirmation answer as `intent` with values `confirm`/`edit`, and they live on separate pages, so nothing collides today. T41 states the fix belongs **before** a second confirming form exists, not after — PC3 is that second form. Values become `deposit-confirm`, `deposit-edit`, with the existing two renamed to `transfer-*` and `mp-*`.

Renaming two working files is outside PC3's nominal scope and is done anyway, because after this change the collision becomes reachable by anyone who puts two settings forms on one page.

### D17 — T44 is decided, not inherited silently

Form state is lost without JavaScript because `useActionState` is not given a `permalink`. PC3 adds a form and inherits the behaviour without worsening it. The debt is recorded as **decided for B4**: from B4 onward the forms are used by clients rather than by a single owner, so the population that might have JavaScript disabled stops being one person. Fixing it here would mean per-form permalinks and losing the group-level `loading.tsx` skeletons — a UI architecture decision that deserves its own change rather than riding along with a settings editor.

## Risks / Trade-offs

**A policy that is simply wrong, entered confidently and confirmed** → Nothing in the system can know the owner meant 3% and not 30%. The effect preview is the mitigation and it is a good one — the number is shown against a real price before it is stored — but it is a human check, not a validation. Accepted knowingly: the alternative is a product that refuses values the owner is entitled to choose.

**The provisional `MIN_DEPOSIT_AMOUNT`** → A floor set above the real minimum silently raises small deposits; set below, it fails to protect. Mitigated by declaring it once, documenting it as provisional, and tying its confirmation to B5. The failure it prevents in the meantime — a $0,50 deposit — is worse than the imprecision it introduces.

**The effect preview needs the service catalogue** → One additional read on the confirmation path, and a preview that is only as truthful as the catalogue at that instant. Bounded by the single-owner product; the price cap in the computation is what covers the catalogue changing afterwards.

**Two tabs editing the policy** → Last-write-wins, T36's shape. Bounded by the column-scoped write: a lost update cannot reach PC1's or PC2's columns. Partially covered by accident, as in PC1 — the second tab's confirmation shows the owner the policy it is about to store, which is where they would notice it is not the one they just saved.

**A committed write whose acknowledgement is lost** → The owner cannot distinguish "not saved" from "saved and not acknowledged", and the value decides what every future client is charged. Mitigated exactly as PC1 does: the message asks them to reload rather than asserting failure.

**The `serviceSchema` refactor touches a stable, load-bearing file** → Mitigated by the constraint that its existing tests pass unmodified, and by sequencing the extraction first so a regression surfaces before anything is built on top of it.

**No rate limiting on the actions** → Accepted and stated rather than fixed: PC3 makes no outbound call, so there is nothing to amplify, and `base-standards.md` §4 fixes a single administrative user for this version.

## Migration Plan

No schema migration. `depositType` and `depositValue` exist from PC1's migration with the correct types, nullability and precision, and `data-persistence` already specifies them.

Deployment is an ordinary code deploy with no new secret and no new environment variable. Rollback is a revert: the columns are left exactly as PC1 created them, and a null `depositValue` is the unconfigured state the product already handles.

`docs/data-model.md` is amended **before** implementation, per `base-standards.md` §7 — §14 for the deposit rules, §11 for the snapshot guarantee.

## Open Questions

- **Mercado Pago's real minimum chargeable amount in ARS.** Owned by D12, closes before B5. Until then `MIN_DEPOSIT_AMOUNT` is provisional and marked as such in code.
- **Whether a test Mercado Pago account's nickname reliably carries a recognisable marker.** Owned by T42, requires observation against more than one account. Not blocking PC3.
