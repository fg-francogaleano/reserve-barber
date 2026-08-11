## Context

M1–M3 established a house shape for dashboard writes: one row, scalar fields, a Zod parse inside a Server Action, an owner predicate travelling with the write, and a repository contract that makes an unscoped query inexpressible. Every one of those changes wrote a single row from a single form.

M4 breaks that shape in one specific way: the unit of work is a **set**. The owner does not edit an assignment, they declare which assignments should exist. That difference brings in failure modes M1–M3 never had to answer — a form whose baseline is stale, a write that can apply partially, and a removal that happens because something was *absent* from a submission rather than because anyone asked for it.

It also brings the project's first relation whose integrity rule the database cannot enforce. `Barber` deliberately has no `ownerId` column (`data-model.md` §5): ownership is derived through `location`. `Service` deliberately has one (§6). A join between them therefore has no shared column for a composite foreign key, no expressible unique constraint spanning both owners, and no `CHECK` that could compare them. The same-owner rule is an application invariant or it is nothing.

Constraints inherited from the stack, all load-bearing here: Cloudflare `workerd` with no native Prisma engine; the `@prisma/adapter-pg` driver adapter through Supavisor in **transaction mode**; a pool configured `max: 5, maxUses: 1` so no socket is carried across request contexts; and React 19 Server Actions, which reset uncontrolled forms on resolve.

## Goals / Non-Goals

**Goals:**
- Make a service bookable by recording who performs it, and make "nobody performs this" visible on the dashboard rather than discoverable only in the booking flow.
- Settle set-write semantics once, correctly, so B2 and later stories inherit them instead of re-deciding.
- Enforce the same-owner invariant at exactly one point and prove it with an executable test rather than a comment.
- Keep the write idempotent under double submit, timeout-retry, and pre-hydration double click.
- Close the tech debt that named this change as its trigger.

**Non-Goals:**
- The service→barbers direction of the same editor. One relation, one write path.
- Per-barber price or duration overrides. `Booking.priceAtBooking` snapshots the service price; a per-barber price is a different story with a different data shape.
- Any public booking behaviour. B2 consumes this; it does not ship here.
- Deactivation of barbers or services (M6), rate limiting (T17), or optimistic concurrency control (T8).

## Decisions

### D1 — A dedicated route, not a field on the M2 barber form
`/barberos/[id]/servicios`, reached from the barbers list.

Folding a set-valued relation into the existing barber form would put two write semantics behind one submit: scalar last-write-wins for the name, set-diff for the assignments. A partial failure would then leave "name saved, assignments not" with no way to express that in one `useActionState` result. It would also reopen M2's closed spec, which `base-standards.md` §7 forbids without updating its artifacts.

*Alternative considered:* a section appended to the barber edit form. Rejected on the partial-save ambiguity above.

### D2 — Barber → services only
The reverse view is served read-only by the bookability state on `/servicios`. Two editors for one relation means two write paths that must agree forever; the second one earns nothing the first does not already do.

### D3 — The diff is computed against a rendered baseline, not against stored state
**This is the central decision of the change.** The form submits two parallel multi-value fields: `renderedServiceIds` (every id the page displayed) and `serviceIds` (the subset checked). The write computes:

- `toAdd = checked − stored`
- `toRemove = (rendered − checked) ∩ stored`

*Alternative considered — diff against stored alone* (`toRemove = stored − checked`): rejected. The checkbox list is a snapshot taken at render time. Under that rule, an assignment created after the page loaded — by a second tab, a second device, or any future automated path — is deleted by a form that never displayed it and whose owner never saw it. The damage is asymmetric to anything in M1–M3: not a name that has to be retyped, but a service that silently stops being bookable, with no error, no badge the owner is currently looking at, and no audit trail.

Under D3, a conflict over an id **both** views rendered remains last-write-wins, which is the same exposure M1–M3 already accept. A conflict over an id only one of them ever saw becomes unreachable by construction.

`rendered` is client-supplied and therefore untrusted, but it grants no privilege: the worst a forged baseline can do is remove assignments the owner is already authorised to remove by unchecking them. Both sets are still validated against the owner's services (D6).

### D4 — One batched transaction in array form, never the interactive callback
```
$transaction([ deleteMany(toRemove), createMany(toAdd, skipDuplicates) ])
```

The interactive form `$transaction(async tx => …)` holds a connection open across application round trips. Against Supavisor in transaction mode with `maxUses: 1`, that ties a pool slot to the Worker's own latency for no benefit here — the two statements have no data dependency on each other. The array form is a single checkout containing `BEGIN … COMMIT`, which is precisely what transaction-mode pooling exists to support.

Confirmed present in the generated client before committing to this shape: `$transaction` array overload at `src/generated/prisma/internal/class.ts:179`, `skipDuplicates` at `src/generated/prisma/models/Service.ts:1378`.

*Constraint on any fallback:* if the runtime gate fails, the replacement is per-row `upsert` **inside the same batch array**. A loop of awaited writes outside a transaction is forbidden — a Worker CPU or wall-clock cutoff mid-loop would leave the database holding a set the owner never chose while the UI reports failure.

### D5 — A duplicate assignment is absorbed, never reported
`skipDuplicates: true`. Every other unique constraint in this codebase (§4–§6 names) surfaces to the owner as a field error, because a duplicate name is a mistake they can correct. A duplicate assignment is not a mistake at all — it is the same intent expressed twice, by a double click or a retried timeout. Reporting it would be reporting success as failure.

This also keeps a `BarberService` violation from ever reaching the application layer, which is what bounds D14.

*Known future trap:* the moment this table gains a mutable column (a per-barber override), `skipDuplicates` stops meaning "tolerate a re-submission" and starts meaning "silently discard the update". Recorded as **T21** with that column addition as its trigger.

### D6 — The same-owner invariant lives at one choke point, proven by test
Before any write: resolve the barber through `findByIdForOwner`, then assert every submitted id (checked **and** rendered) is in the owner's service set. A foreign or unknown id rejects the whole submission — it is never filtered out silently, because a filtered id means the save did something other than what the form showed.

No database mechanism can back this (see Context). Two rules follow and are binding rather than advisory: **no code path may write `BarberService` except through `BarberServiceAssignmentService`**, and the invariant is proven by a test that attempts a cross-owner assignment and asserts zero rows written. `createMany` is a raw multi-row insert that bypasses relation validation entirely — the foreign keys prove both ids exist, never that they agree about the owner. This test is also the first executable evidence of cross-owner isolation in the project, narrowing **T11**.

### D7 — `onDelete: Cascade` on both foreign keys
A join row has no meaning without either endpoint. This deliberately differs from `Barber → Location`, which is `Restrict` (§5): there the child carries data of its own that must not vanish silently; here the row *is* the relationship.

The rule is inert today — the application has no hard-delete path, and M6 is deactivation — and exists so the behaviour is already correct whenever deletion arrives.

### D8 — Bookability is derived at read time, as a three-term conjunction
A service is bookable iff: it is active **and** has at least one assignment **and** at least one of those barbers is active.

*Alternative considered — a denormalized `Service.isBookable` column:* rejected. It requires invalidation on four distinct events (assign, unassign, barber deactivation, service deactivation) and is wrong the first time one is missed. The derived read is a single indexed aggregate over a set bounded by the 50-service cap.

The third term is not decoration: M3's original wording checked only the assignment, which would have reported a deactivated service as bookable the moment M6 ships. `data-model.md` §6 was corrected ahead of this change.

### D9 — Assignable = active services ∪ already-assigned services
A service may be **added** only while active, but one already assigned and deactivated afterwards **remains** assigned. This is the same shape as M2's barber/inactive-location exemption, and like it the exemption is decided from stored state, never from a value in the submission.

Forcing removal on deactivation would mean deactivating a service silently rewrites every barber's assignment set — destroying information the owner would have to reconstruct by hand on reactivation.

### D10 — Native checkboxes, and the baseline as proof of submission
Native `<input type="checkbox">`, not shadcn/Radix `Checkbox`, for the reason `frontend-standards.md` already gives for `Select`: Radix renders a non-form-associated control that submits nothing before hydration.

An all-unchecked form omits `serviceIds` entirely, so an empty selection is indistinguishable from a missing field — unless `renderedServiceIds` is read as the evidence that a submission occurred. D3's baseline field therefore does double duty, and "unassign everything" is a valid save rather than a validation error.

### D11 — Bounds are applied before any database read
The submitted lists are deduplicated, type-checked, and rejected above `MAX_SERVICES_PER_OWNER` (50) before the barber lookup. A crafted submission cannot turn one save into an unbounded `IN` list or an unbounded insert. The action remains owner-authenticated, so **T17** is not escalated by this change — but the work behind the authentication check is now bounded rather than merely small.

### D12 — Counts are one aggregate each, joined in memory
`countActiveBarbersByService` and `countServicesByBarber` are a single `groupBy` per list page for the whole owner. Per-row counting would be an N+1 against a pooled connection; both result sets are bounded by the service and barber caps.

### D13 — T15 is bounded by construction, not by inspecting driver errors
`BarberService` is written through its own repository, never nested inside a `Service` or `Barber` write. Therefore `ServiceCatalogService` and `BarberCatalogService` still each participate in exactly one reachable unique constraint, and their unqualified `P2002` translation stays correct.

*Alternative considered — reading `error.meta.target` to qualify the violation:* rejected for the same reason M3 rejected it. That drags Prisma's error shape into the application layer, which is exactly what the layering exists to prevent. The guarantee is expressed as a regression test asserting a `BarberService` violation cannot surface as `DuplicateServiceNameError` or `DuplicateBarberNameError`.

### D14 — T8 is not escalated
With D3, the collateral-damage class disappears. What remains is a genuine conflict over an id both views rendered, which resolves last-write-wins exactly as M1–M3 already accept. Adding a version column here would cost more than the failure it prevents, and "Exactly one Owner" still bounds how often two concurrent editors exist.

## Risks / Trade-offs

- **`$transaction` array form or `createMany({ skipDuplicates })` misbehaves on `workerd` over Supavisor** → Types are confirmed present, and transaction-mode pooling supports `BEGIN…COMMIT` within one checkout by definition, so the residual risk is runtime not design. Gated by the first implementation task, with the D4 fallback pre-designed so a negative result changes an implementation detail rather than the architecture.

- **The same-owner invariant has a single enforcement point and no safety net** → Accepted deliberately; nothing else is expressible. Mitigated by an executable cross-owner test, and by keeping the repository the only writer.

- **Last-write-wins on a co-rendered id can still lose an intentional change** → Accepted (D14). Bounded to the same exposure M1–M3 carry.

- **The Next.js Router Cache could serve a stale bookability badge after an assignment** → Both pages are `force-dynamic` (client staleTime 0) and both paths are revalidated. Confirmed by manual verification rather than assumed, because a stale badge is a lie about revenue-bearing state.

- **A timed-out write may have already committed** → The retry converges: additions are absorbed by `skipDuplicates`, removals of absent rows are no-ops, and the diff is recomputed against fresh state. This idempotence is a designed property, not a coincidence, and any change to D4 or D5 must preserve it. The `infrastructureError` copy still tells the owner to check before retrying (T12 precedent).

- **50 checkboxes is a long form; a validation error can render off-screen** → Focus moves to the error summary on rejection, and the offending service is identified inline rather than only in a form-level banner.

- **React 19 resets uncontrolled forms on resolve** → The fieldset is disabled while pending so mid-flight toggles cannot be silently discarded, and the rejected-state remount is keyed so the echoed selection wins over stale DOM state.

## Migration Plan

1. Schema-only migration `add_barber_service` creating the table, the composite unique, the `serviceId` index, and both cascade rules. Purely additive — no existing table is altered, no backfill, no data at risk.
2. Regenerate both Prisma clients (`prisma` and `prisma-cli`).
3. Run the runtime gate before building on the write path.
4. Ship the write path, then the two list-page reads.

**Rollback:** the migration is additive and the feature is reachable only from a new route. Reverting the application code leaves an unused table with no orphaned references; dropping it is safe because nothing outside this change reads it until B2.

## Open Questions

None blocking. The runtime gate (D4) is a verification step with a designed fallback, not an unresolved decision — it cannot run before the table exists, which is why it is the first implementation task rather than a prerequisite of this document.
