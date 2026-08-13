## Context

`PaymentConfig` is the last entity of Phase 1b that no story has touched, and it is unlike every entity built so far. `Location`, `Barber`, `Service` and `TimeOff` are collections owned by one owner. This is a **single row shared by three stories**: PC1 writes the transfer destination, PC2 the Mercado Pago credentials, PC3 the deposit policy. Whatever PC1 decides about how that row is created and partially written, PC2 and PC3 inherit.

It is also the only story in the project where a wrong value costs money rather than convenience. Every other data-entry mistake so far is visible and reversible — a misspelled barber, a wrong price, an absence on the wrong day. A transposed digit in a CBU sends every client's deposit to a stranger's account and stays invisible until the owner goes looking for money that never arrived.

Two constraints come from outside this change. `data-model.md` §14 declares `depositValue` required, which cannot hold if the row is created before PC3 runs; and it declares `transferHolderName` optional, which cannot hold if the value is what lets a client verify who they are paying. Both are amended before implementation under `base-standards.md` §7.

The runtime is unchanged: Workers, Prisma over the Supavisor pooler in transaction mode, server actions for dashboard mutations. The check-digit algorithm is the only genuinely new logic, and it is pure arithmetic.

## Goals / Non-Goals

**Goals:**
- Catch the mistyped destination before a client's money moves, by whatever means the format allows.
- Settle the shared-row lifecycle — creation, partial writes, concurrent writes — once, for all three PC stories.
- Keep the Mercado Pago access token structurally unable to reach the public flow, rather than conventionally unlikely to.
- Let the owner turn transfer off without turning the business off.

**Non-Goals:**
- Mercado Pago credentials (PC2) and deposit policy (PC3), beyond creating their columns and not clobbering them.
- Displaying the destination to clients, receipt upload, receipt review — B6 and D2.
- Verifying that the account belongs to the owner. No API available to this project can do it, and pretending otherwise would be worse than the confirmation step that replaces it.
- Per-location or multiple destinations. `project-context.md` fixes one shared destination for the whole business.
- A payment-readiness panel showing transfer, Mercado Pago and deposit status together — that belongs to PC3, the story that first knows all three.

## Decisions

### D1 — One migration creates the whole table, unused columns included
The `add_payment_config` migration creates every column from `data-model.md` §14 plus the `DepositType` enum, not just the three PC1 writes.

A single-row entity assembled across three migrations is three chances for the three stories to disagree about its shape, and each later migration is an `ALTER` against a table already holding the owner's live payment data. Creating it once means PC2 and PC3 are pure application stories with no schema churn at all.

*Alternative considered — migrate per story:* rejected. It buys a smaller diff today and pays for it with two `ALTER` migrations over production payment data and a table whose definition is only complete if you read three changes.

### D2 — The CBU check digits are verified, and the algorithm is gated on real fixtures
A CBU/CVU is 22 digits in two blocks: block 1 is 7 digits plus a check digit (weights `7,1,3,9,7,1,3`), block 2 is 13 digits plus a check digit (weights `3,9,7,1,3,9,7,1,3,9,7,1,3`). Each check digit is `(10 − (Σ mod 10)) mod 10`. CVUs share the format.

Length alone is not validation. It accepts every transposition, and the transposition is the failure mode that costs money silently.

**The weight tables are treated as unverified until fixtures prove them.** The implementation is gated on CBUs from real accounts at more than one bank, plus at least one CVU. A wrong table rejects valid accounts — an owner who cannot configure their real CBU is a worse outcome than the typo the check exists to catch, and it is the failure that would ship unnoticed because nobody tests with an account they do not have.

*Fallback, if the fixtures contradict the algorithm:* drop to digits-only-and-length, keep D14's confirmation step, and record the checksum in `tech-debt.md` with "a verified fixture set" as its trigger. Do not ship an algorithm that the fixtures do not support.

### D3 — Store normalized, format at render
Persist digits only; group into blocks of four for display. Persist the alias lowercased and trimmed.

Storing what was typed makes two spellings of one account two different strings, which breaks any comparison, deduplication or lookup added later. Formatting at render is where it belongs, because it is a reading aid: 22 unbroken digits cannot be checked by eye, which is the one verification the owner can actually perform.

### D4 — The alias is lowercased
The Argentine alias namespace is case-insensitive and canonically lowercase. Normalizing removes a class of "the transfer doesn't work" reports caused by a bank rejecting the casing, and costs nothing — no information is lost.

### D5 — The transfer write names its own three columns and no others
The `upsert` sets exactly `transferCbuCvu`, `transferAlias`, `transferHolderName`; its create branch adds only the schema defaults.

Three stories share one row. A write that supplies the whole entity resets the other two stories' columns to whatever the transfer form held — and reports success while doing it, which is the worst shape a data bug can take. This is the decision PC2 and PC3 inherit verbatim.

### D6 — Transfer fields are not encrypted; the Mercado Pago token still is
These three values are printed to every client who chooses transfer. They are published data, not credentials. Encrypting them would buy nothing and break B6's read path.

`mpAccessToken` is the exact opposite — it authorizes charges — and its encryption requirement (PC2) is untouched by this.

### D7 — The public flow gets a narrow projection, not the entity
`findTransferDetailsForPublic(ownerId)` returns only the three transfer fields. The full row never leaves the dashboard.

`mpAccessToken` sits in the same record. One serialized prop, one logged object, one error payload carrying the entity into the public surface leaks it. A projection that does not carry the field cannot leak it — the same reasoning M5b applied to `reason`, and the reason that rule is restated as a type rather than as discipline.

### D8 — The holder name is constrained by whitelist
Unicode letters, spaces, apostrophe, hyphen, period — after NFKC normalization and after discarding control characters, zero-width characters and bidirectional overrides.

React escapes output today, so there is no XSS now. N1 is where it breaks: email templates are assembled as strings. A value that cannot contain markup is safe in every renderer, current and future, without any of them having to be right. The cost is rejecting an unusual but legitimate name, which the owner resolves by writing it without the unusual character.

*Alternative considered — escape at each render site:* rejected. It requires every future consumer to remember, and the consumer that forgets is the one sending email.

### D9 — Auditing is a log line now, a table later
Each successful write logs the operation, owner, presence flags, and the **previous and new last four digits** of the CBU. Never the full value.

The last-four pair is enough to reconstruct when a destination changed, which is the only question that matters when deposits arrive somewhere unexpected. A real `PaymentConfigAudit` table is recorded in `tech-debt.md` with an explicit trigger: **the first report of a deposit that did not arrive.** Building it now would be inventing forensics for an incident class that may never occur; building the log line now is what makes that incident investigable.

### D10 — No rate limiting on the save action
`requireOwner()` is the control. `loginThrottle` exists because login is anonymous; this surface is not, there is exactly one administrative user, the write is free, and nothing can be enumerated through it. Recorded here so it is not re-argued in review.

### D11 — The page declares its own non-cacheability
`export const dynamic = 'force-dynamic'` on `app/(dashboard)/transferencia/page.tsx`, even though the dashboard layout already declares it. A page that renders a bank account does not inherit that property from an ancestor someone may edit later.

### D12 — A unique-constraint violation on `ownerId` is retried once
Two concurrent saves against a row that does not yet exist both take the `upsert` create path; the loser gets `P2002` having done nothing wrong. Reporting that as an infrastructure failure tells the owner their save failed when the stored data is correct.

Retry exactly once — the retry finds the row and takes the update path. A second violation is a real failure and is surfaced. Bounded at one attempt, never a loop.

### D13 — A failed write says "reload to see what was stored"
Infrastructure failures are returned as form state with the typed values intact, and the message carries an explicit reload instruction.

A write can commit and then lose the connection. Without the instruction, the owner cannot tell "not saved" from "saved, not acknowledged", and the difference determines where their clients' money goes. With it, they resolve the ambiguity themselves in one keystroke — the persisted panel always renders from the database (D3), so a reload is authoritative. Re-submitting is also safe, because the write is idempotent.

### D14 — Changing a stored destination requires one confirmation
On a submission that changes an existing CBU or alias, the action returns a confirmation state carrying the normalized, formatted value; only an explicit confirm persists it.

The alias format has no check digit. `mi.barberia` and `mi.barberia1` are both valid and may belong to different people, and nothing in software can tell them apart. Confirmation is the only remaining defence, and it works because the owner is shown the **normalized** value — what will actually be stored, not what they typed.

Deliberately narrow: never on first configuration, never when only the holder name changed, never on an unchanged re-save. Friction on every save is friction that gets clicked through.

Server-returned form state, not a browser dialog — it survives without JavaScript, and a native dialog would block the runtime.

*Alternative considered — type the destination twice:* rejected. It catches typing errors, which the checksum already catches for CBUs, and misses the case it needs to catch: a confidently-wrong alias gets typed identically twice.

### D15 — When both destinations exist, both are shown, CBU first
Banks route by CBU; the alias is a typing convenience. Showing one and hiding the other would make the system guess which the client prefers. Stating precedence here means B6 does not have to invent it.

### D16 — The no-payment-method warning comes from the server
Only the server knows whether PC2 has configured Mercado Pago. Computing the warning client-side would require shipping payment-configuration state to the browser for a UI hint, and it would not work before hydration. Returned with the save result.

### D17 — No draft persistence
Three fields. A half-entered payment destination is a state that then has to be distinguished from a configured one everywhere it is read, in exchange for saving the owner one re-typing.

### D18 — Last-write-wins across tabs; no concurrency token
The conflict requires one person to race themselves in two tabs, and D5 already guarantees the collision cannot cross into PC2's or PC3's columns. Recorded in `tech-debt.md` with its trigger: **the first story that introduces a second administrative user.**

### D19 — No payment-readiness panel in this story
Only the single warning from D16. The full transfer / Mercado Pago / deposit readiness view belongs to PC3, the story that first has all three facts. Building it here would make PC1 depend on PC2 and then need rewriting when PC3 lands.

## Risks / Trade-offs

**The check-digit weight tables are wrong and reject valid accounts** → Gated on fixtures from real accounts at more than one bank plus a CVU, before the validator is wired into the schema. Documented fallback in D2 (length-only + D14's confirmation), not a silent downgrade.

**A confidently-wrong alias is saved and clients pay a stranger** → Unfixable by validation; mitigated by D14's confirmation on the normalized value and D3's read-back display. Residual risk is accepted and explicitly owned by the owner, which is the correct place for it — it is their account number.

**`data-model.md` is amended to unblock this story and the amendment is forgotten downstream** → The nullable `depositValue` moves the "is this business bookable?" guarantee out of the schema and into an application check that does not exist yet. Stated as a requirement in the `data-persistence` delta and carried into PC3's and B4's preconditions, not left as a comment in the schema.

**The whole-row read leaks the Mercado Pago token once B6 exists** → D7's narrow projection is created in this change, before any public consumer exists, so the wide read never becomes the path of least resistance.

**Two unused nullable columns invite a partially-configured row that looks configured** → A row with `depositType = PERCENT` and `depositValue = null` is coherent only because the booking-flow gate checks both. That gate is specified here and implemented by PC3/B4.

**The retry in D12 masks a genuine unique-constraint problem** → Bounded to one attempt and scoped to `ownerId` on this entity only; the second failure surfaces normally.

## Migration Plan

1. Amend `docs/data-model.md` §14 (nullable `depositValue`, conditional holder name, bookability gate as an application rule). Spec before code, per `base-standards.md` §7.
2. Add the model and enum to `prisma/schema.prisma`; `npx prisma migrate dev --name add_payment_config`; regenerate **both** Prisma clients (`workerd` and CLI).
3. Build inside-out: `cbu` domain module (fixtures first) → schema → service → repository → action → page. TDD throughout; the domain module has no dependencies and is where the risk concentrates.
4. Verify on the Workers runtime with `npm run preview`, not only `next dev` — the M5b precedent verified against the deployed Worker and this should match it.
5. Manual pass over all three states plus the confirmation path and a forced write failure.

**Rollback:** the migration is purely additive and creates no rows, so reverting the application code leaves an unused table and enum behind with no data loss and no broken reads. There is nothing to un-migrate under time pressure.

## Open Questions

- **Are the D2 weight tables correct?** Resolved by fixtures during implementation, not by discussion. If they fail, take the documented fallback rather than improvising.
- **Does the owner want transfer offered when only an alias is configured?** Assumed yes — it is the common local case and the spec is written that way. Cheap to tighten later; expensive to discover after B6 ships.
- **Should the confirmation step (D14) also cover the holder name?** Assumed no: a wrong holder name is visible to the client and stops the transfer rather than misrouting it. Revisit if a client ever reports paying to a name they did not recognize.
