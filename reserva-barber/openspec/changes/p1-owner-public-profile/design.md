## Context

Phase 1a is complete: five stories built the same vertical five times — Zod schema in the application layer, a service depending on repository interfaces, a Prisma repository, a Server Action calling `requireOwner()` first, a form driven by `useActionState`, and Spanish copy isolated in `src/lib/copy.ts`. P1 follows that vertical for its fields and diverges from it in exactly two places: it writes to object storage, which no prior story has touched, and it produces something an unauthenticated stranger will eventually read.

Two constraints shape most of what follows. The runtime is `workerd` under OpenNext, where request handling has already diverged from Node once (`docs/s0-versions-decision.md`). And the database is reached through a transaction-mode pooler, where a read and a subsequent write may not share a connection — the reason `Location.name` uniqueness is enforced by an index rather than by a check (`prisma/schema.prisma:51-55`).

The owner has confirmed five product decisions, recorded in the proposal. This document covers how they are built.

## Goals / Non-Goals

**Goals:**
- One profile per owner, editable as a single form, created on first save.
- Images that reach a public bucket small, re-encoded, and stripped of capture metadata.
- A slug that is canonical at rest and whose uniqueness the database owns.
- A shareable link the owner can copy, honestly labelled as not yet resolving.
- An `IImageStorage` contract that B6's private receipts bucket can implement without rewriting.
- T10 resolved or documented.

**Non-Goals:**
- The public page at `/b/[slug]`, and any change to the route guard. That is B1.
- Slug history, aliases, or redirects from a previous slug.
- Cropping, repositioning, or any image editing beyond downscaling.
- Automatic reclamation of unreferenced storage objects.
- Optimistic concurrency between two editors of the same profile.
- Any change to `next.config.ts`.

## Decisions

### D1 — The gate runs first, before any code that assumes it passes

`scripts/p1-gate.ts` and a preview-runtime upload check precede implementation. The gate proves three things against real infrastructure: a duplicate `publicSlug` insert raises `P2002` and leaves the existing row untouched; a storage object survives an upload, a public read, and a delete; and a multipart body reaches a Server Action intact under `opennextjs-cloudflare preview`.

The third is the one that matters. `next dev` runs on Node and proves nothing about `workerd`. If it fails, the transfer mechanism becomes a signed upload URL and a direct browser-to-storage PUT — the profile save then records a key the browser already wrote, rather than receiving bytes. That is a different action signature, a different validation point, and a different failure mode. It is cheap to discover now and expensive to discover after the editor exists.

*Alternative rejected:* build the editor and gate at the end, as M5a and M5b did. Their runtime risk was a conversion whose failure mode was a wrong value; this one's failure mode is a design that cannot work.

### D2 — The image is made small on the client, not admitted large by the server

A canvas decode-and-re-encode bounded to a maximum dimension, targeting roughly 500 KB, runs before the file is attached to the form. This is what keeps `serverActions.bodySizeLimit` at its default.

The limit is global. Raising it to 6 MB to admit a phone photograph also raises the body `loginAction` will accept, and that action is reachable unauthenticated. `loginThrottle.ts` limits attempts, not bytes, so the ceiling is the only thing bounding large-body abuse against login today. Trading auth hardening for the convenience of not resizing an image is a bad trade, and the resize is a well-understood browser operation.

Re-encoding also discards EXIF, which is the whole of D3 — one operation, two requirements. That is not a coincidence to note in passing; it is why this approach was chosen over the alternatives.

*Alternatives rejected:* raise the global limit (widens the auth surface, as above); a 1 MB server limit with an instruction to the owner to resize manually (almost no phone photo qualifies, so the feature would fail for its actual user); server-side resizing (the bytes have to arrive first, which is the problem being solved).

### D3 — Metadata is removed by construction, not by a stripping step

There is no EXIF parser and no strip routine. The canvas re-encode from D2 produces a new image from decoded pixels; embedded metadata does not survive the round trip. A separate stripping step would be a second thing to maintain and a second thing to forget.

The server still validates by content (D5), so a file that skipped the client path is rejected rather than stored with whatever it carries.

### D4 — Unchanged, replaced and removed are three states on the wire

Each image slot submits an explicit intent alongside its optional file: unchanged, replace (with a file), or remove. The action reads the intent, never the presence or absence of a file.

An HTML form resubmits empty file inputs. Inferring "remove" from "no file" deletes both images every time the owner edits only their bio — the highest-probability defect in this change, and one that silently destroys work the owner cannot recover. Making intent explicit removes the inference entirely.

*Alternative rejected:* comparing the submitted file against the stored URL. There is nothing to compare — the browser sends no file at all for an untouched input.

**The intent is raised asynchronously, so the form has to be closed while it is in flight.** The client re-encodes the chosen file before the slot moves to `replace` (D2), and until that finishes the input holds the *original* file while the intent still reads `unchanged`. Submitting in that gap sends the two together; the action obeys the intent, ignores the file, saves everything else and reports success. The owner sees a confirmation for a replacement that never happened. Measured on `workerd` with a 2400×1800 PNG: **1,689 ms** with the save button enabled and no progress disclosed. Submission is therefore blocked while any slot is preparing, which is what `COPY.businessProfile.imageProcessing` was written for — the copy existed from 11.1 and nothing rendered it, which is the tell that the state was designed and then dropped.

**The rule has a second half, learned by running it.** Declaring intent is not enough: the intent must be *returned to `unchanged` once a save succeeds*. The browser empties a file input after submission, so a slot left on `replace` declares a replacement with no file behind it, and validation rejects the whole form. The symptom is that every save after the first one fails and saves nothing, reporting an error against an image the owner never touched. Nothing in the unit tests could see this — the form was never asked to submit twice — and it took driving the editor on `workerd` to find. The success signal therefore carries a timestamp rather than a boolean, because two consecutive successes must be distinguishable for the reset to fire on the second one.

### D5 — Type is decided by the first bytes; the key is decided by the server

Validation reads the leading bytes and matches JPEG, PNG or WEBP signatures. That result determines both the stored content type and the key's extension. The declared content type and the filename are read for nothing.

The key is `{authUserId}/{photo|cover}-{epochMs}.{ext}`, every segment server-held. Storage keys accept `/`, so a filename reaching the key is a path-traversal primitive — and the bucket that B6 will add for receipts is exactly what such a traversal would aim at. The timestamp component also means a replacement never reuses a key, so no cache can serve the old image under the new URL.

The leading segment is the **Supabase auth user id**, not the Prisma `Owner.id`. They are different values (`Owner.authUserId` maps one to the other), and only the former is what a storage policy can compare against `auth.uid()`. Using it is what lets the database enforce the prefix rather than the application promising it — see D13.

*Alternative rejected:* trusting `File.type`. It is client-controlled and proves nothing; SVG is excluded for the same reason (a script-execution surface served from a public origin).

### D6 — Upload, then transact; orphans are logged, not chased

The upload completes before `$transaction` opens. Storage is not transactional and a network round trip must not hold a database transaction open on a pooled connection.

The cost is accepted explicitly: a database failure after a successful upload leaves an object nothing references. It is logged with its key and left. There is no reaper in this change. With a single owner and a client-side downscale, the accumulation is bounded by the number of failed saves times a few hundred kilobytes — a bound worth stating rather than a problem worth solving now. Reclaiming it can never be allowed to fail a save.

*Alternative rejected:* upload inside the transaction, deleting on rollback. It holds a connection across a network call and still leaks whenever the delete itself fails.

### D7 — The whole form is one transaction, and the link set is replaced

`upsert` the profile on `ownerId`, `deleteMany` its links, `createMany` the submitted ones — one transaction.

Replacement rather than diffing follows the weekly-schedule precedent: the owner edits the set as a whole, and an additive write duplicates on a retry after a commit whose acknowledgement was lost. Replacement makes the retry idempotent by construction.

`upsert` on `ownerId` also means first-save and later-save are one code path rather than two.

**Replacement puts the whole set at the mercy of what the form re-renders, which is how D4's lesson turned out to be more general than images.** React 19 resets an uncontrolled form once its action resolves, restoring each field to the `defaultValue` of the render that follows. The social rows were uncontrolled and their row state was seeded from the server's `defaults` only at mount, so a row added or edited during the session snapped back the moment the save succeeded. Blank rows are discarded as absence (D9's cheap-rejection rule applied to the link set), so the reverted row read as "no link" and the *next* save replaced the stored set without it — silently deleting a link the owner had already saved. Found by driving the editor on `next dev`, one save after the create; the unit tests never submitted the same form twice with a row added in between.

The rows are therefore **controlled**: their values live in component state, which React re-renders after the reset, so the DOM cannot diverge from what the owner typed. Controlled state also survives a rejected save without the action having to echo the rows back through `values`.

*Alternative rejected:* re-seeding the row state from the action's returned `values` on a `savedAt` transition, mirroring what the image slots do. It leaves the rows uncontrolled and therefore still dependent on the reset landing before the re-seed, and it fixes only the success path — a rejected save would keep reverting. The image slots use the timestamp because a `File` genuinely cannot be echoed back into an input; a string can.

### D8 — Three unique constraints, three distinct outcomes, translated in the repository

`ownerId`, `publicSlug` and `(businessProfileId, platform)` can each raise `P2002`. The translation inspects which constraint fired, and it happens in `PrismaBusinessProfileRepository` — the infrastructure layer — which throws the corresponding domain error. The application layer never sees a Prisma error at all.

**This decision was rewritten after the gate ran, and both halves of it changed.**

*Mechanism.* The first version said to read `error.meta.target`. That field **does not exist on this stack**. Prisma 7 with the `@prisma/adapter-pg` driver adapter reports:

```
meta.driverAdapterError.cause.constraint.fields = ['"publicSlug"']
```

— column names arriving already quoted, so an equality check against `publicSlug` fails until the quotes are stripped. `scripts/p1-gate-db.ts` asserted the wrong field first and failed all four probes, which is what the gate was for. It now passes and reports `ownerId`, `publicSlug`, and `businessProfileId,platform` as three distinct values.

*Placement.* Reading that structure in the application layer would violate a decision this project has already made twice. `docs/tech-debt.md` T15 records that M3 and M4 both **deliberately rejected** qualifying the translation by error shape, because "it drags Prisma's error shape into the application layer, which is what the boundary exists to prevent". That objection is correct and it applies here with more force, since the shape in question is now nested four levels deep inside a driver-adapter payload.

Putting the translation in the repository satisfies both requirements at once: the discrimination happens where Prisma is already known, and what crosses the boundary is `DuplicateSlugError` / `ProfileAlreadyExistsError` / `DuplicatePlatformError` — domain types. It also extends a rule `data-persistence` already states for rows ("Repository maps rows to domain entities") to errors, which are the same idea. The existing catalogue services keep their current `code === 'P2002'` checks; this change does not refactor them, but it establishes the precedent T15 can be discharged with later.

A blanket mapping would tell an owner who double-clicked save — colliding on `ownerId` — that their slug is taken. Duplicate platforms are additionally rejected during validation (D9), so reaching that constraint at all means a bug; it is translated anyway, because a constraint that can fire needs a defined outcome.

Slug uniqueness is *only* the constraint. A `findFirst` before the write is not a check across a transaction-mode pooler, and writing one would be worse than writing none: it looks like protection.

### D9 — Validation rejects what the database would reject, when rejection is cheaper there

Duplicate platforms, malformed URLs, non-http schemes, out-of-range lengths and malformed slugs are all caught in the Zod layer, before any upload and before any transaction. Reaching the database with a duplicate platform aborts a transaction whose images have already been uploaded, and returns the owner a form that lost its other fields.

URL protocol checking uses `new URL()` and an explicit allowlist, never a pattern. These strings become `href` attributes on a page anonymous clients will open; a stored `javascript:` URL is stored XSS. A regex that approximates URL parsing is the classic way to admit one.

### D10 — Slug normalization is a domain function, and the offered value is a suggestion

`slugify` sits beside `normalizeName` in the domain layer: pure, no dependencies, tested in isolation. The editor derives a suggestion from the business name as the owner types; the owner may overwrite it. The submitted value is normalized again server-side, because a suggestion the client computed is not a value the server may trust.

Normalization before the uniqueness check is what makes the constraint meaningful — the index compares bytes, so the values it compares must already be canonical. The duplicate message shows the normalized form, otherwise the owner sees an error naming a string they never typed.

No reserved-word list. `/b/{slug}` is a namespace of its own; nothing there can collide with a dashboard route. Recording the absence so the useless guard is not added later.

**Normalizing server-side means the editor must be told what was stored, and it is the action that tells it.** The owner's text and the persisted value diverge the moment they type anything non-canonical, and the field kept showing the text. Because the change warning fires on "field differs from stored slug", it stayed on screen after a successful save — announcing that shared links had broken when nothing had changed. Found by adversarial review, reproduced against the deployed Worker: typing `Barberia Don Juan Centro` over an identical stored slug saved successfully and left the red warning up, with the field and the shareable link disagreeing on screen.

The success state therefore echoes back the **canonical** slug rather than the submitted one, and the form adopts it on the same `savedAt` transition that resets the image slots. Read from the action rather than from the revalidated `defaults`, for two reasons: the case that exposed this does not change `defaults` at all (the stored slug was already canonical), and the action holds the authoritative value with no dependency on when the revalidated tree arrives. A failed save still echoes the raw text, which is what the owner needs to correct.

This matters more than a cosmetic glitch. The warning is the entire mitigation carried for T33, an unrecoverable-by-design behaviour accepted on the strength of it. A warning that cries wolf after ordinary saves is one the owner learns to dismiss before the day it is telling the truth.

### D11 — The origin is resolved server-side

The displayed link is composed on the server from configuration or request headers. `window.location.origin` is undefined during server rendering and produces a hydration mismatch when a client component reaches for it on first paint — a real defect on the one page whose output the owner is about to copy and share.

The copy control itself is client-side, guards `navigator.clipboard` (absent outside secure contexts, and refusable), falls back to selectable text, and confirms success visibly. A copy button with no feedback is indistinguishable from a broken one.

### D12 — Storage is an interface in the domain layer

`IImageStorage` declares upload and delete; `SupabaseImageStorage` implements it in `src/server/infrastructure/storage/`, the folder `backend-standards.md:142` already reserves. `BusinessProfileService` receives it by constructor, alongside the repository.

This is what lets the service be unit-tested with no network, and what lets B6 add a private-bucket implementation instead of copying this one. The interface therefore does not assume public readability: it returns a key and a resolved URL, and visibility is a property of the configured bucket, not of the contract.

### D13 — The upload runs as the owner, not as a privileged service

`SupabaseImageStorage` receives the **session-bound** client the app already builds — `createSupabaseServerClient()`, anon key plus the owner's session cookies — and uploads through it. Authorization comes from a policy on the bucket: the `authenticated` role may insert, update and delete within `public-profile`, restricted to a prefix matching `auth.uid()`. Reads stay public, which is what makes the bucket public in the first place (D12's note on visibility).

**No new secret is introduced.** This is not a preference; the project already decided it. `scripts/provision-owner.ts:7` states that the service-role key "MUST NOT be stored in `.env` — pass them inline for this one-off invocation only", and `.env.example` repeats it as "NEVER add these to .env/.dev.vars". That rule exists because the service-role key bypasses row-level security across the entire database. Promoting it to a Wrangler secret would make it a standing credential of the running Worker, so any code-execution defect, SSRF, or accidental environment dump would escalate from "this feature is broken" to "the whole database is readable and writable". A branding page is not worth that.

Running as the owner also makes the prefix rule enforceable rather than merely intended: with the key's leading segment equal to `auth.uid()` (D5), a write outside the owner's own folder is refused by the database, not by our validation. That is the same preference the schema already expresses everywhere else — the `Location.name` unique index over an application check, and the whole subject of T11.

The session exists by construction at the point of upload: `requireOwner()` has already run and resolved the `Owner` *through* `findByAuthUserId`, so `authUserId` is non-null there. The adapter still guards it rather than asserting it.

*Alternatives rejected:* the service-role key as a Wrangler secret (violates the stated rule, and trades total database authority for convenience); a Supabase S3 access key (still project-wide, and adds a credential where the design now needs none); signed upload URLs issued to the browser (the D1 fallback — appropriate if the body-size gate fails, unnecessary otherwise).

### D14 — T10 is time-boxed and starts with re-verification

`docs/tech-debt.md:143` names an artifact of the inspecting extension as a live explanation for the symptom, and calls the re-verification a five-minute check. It runs before any CSS is read. If the symptom does not reproduce, the entry is closed. If it does, the next step is reading the generated stylesheet from the build output rather than the live DOM — the entry's own recommendation. If neither resolves it inside its box, the finding is written into the entry and the change proceeds; what does not happen is a fourth undocumented copy of the inner-`<span>` workaround.

## Risks / Trade-offs

- **A multipart body does not survive a Server Action on `workerd`** → D1 gates it before any dependent code exists; the fallback (signed URL, direct PUT) is identified in advance.
- **Client-side downscale behaves differently across browsers, or produces a file still too large** → the server enforces its own size bound independently, and the client refuses undecodable files with a message rather than transmitting them.
- **Unreferenced storage objects accumulate** → accepted and bounded by D6; logged with their keys so a later sweep has an inventory. No reaper in this change.
- **A published image remains retrievable after replacement** → intermediary caches are outside our control; disclosed to the owner at the upload control rather than mitigated.
- **Two tabs saving concurrently silently discard one set of social links** → accepted for a single-owner system. Whole-set replacement makes the loss larger than a field-level overwrite would, which is the trade the idempotent retry buys.
- **The slug changes and previously shared links break** → the owner's decision, warned at the point of change. No alias table.
- **A storage policy is a new kind of authorization rule, invisible to the test suite** → it lives in the database, not the repository, so nothing in CI proves it exists. The gate exercises it against real infrastructure (upload accepted inside the owner's prefix, refused outside it), and the policy statement is recorded in the change so it can be recreated.
- **Session expiry mid-upload** → the upload runs under the owner's session, so an expired session fails the write rather than performing it with borrowed authority. It surfaces as an infrastructure error and the owner re-authenticates; nothing is written. This is the correct failure and a strictly better one than a service credential would give.
- **The link is displayed but does not resolve until B1** → disclosed in the editor's copy; the alternative, hiding the link until B1, denies the owner the thing the story exists to give them.

## Migration Plan

1. Gate first (D1): slug constraint, storage round-trip, and the preview-runtime upload check. Stop here if the third fails.
2. No secret to add. Confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` are already present in `.env` and `.dev.vars` — they are, since middleware and the auth client depend on them.
3. Create the public bucket, then the access policy: the `authenticated` role may insert, update and delete within it, restricted to a prefix matching `auth.uid()`; anonymous reads allowed. Receipts do not go here (B6 gets its own, private, with the same policy shape and no public read).
4. Migration `add_business_profile`: two tables, one enum, two unique constraints, one index. Purely additive — no existing row is read or written, so rollback is `migrate resolve` plus a drop, with no data to recover.
5. Domain, application, infrastructure, then presentation, TDD throughout.
6. T10 (D14).
7. Verify on `next dev`, then `opennextjs-cloudflare preview`, then the deployed Worker — the three-environment order the deployment spec already requires.

Rollback: the feature is reachable only from a new nav entry and a new route. Reverting the commit removes both; the tables can be left in place harmlessly since nothing else references them.

## Open Questions

- **Does the preview-runtime upload check pass?** Unknown until D1 runs, and it decides the transfer mechanism. Everything else in this design is stable under either answer except the shape of the save action.
- **What maximum dimension does the cover image want?** The downscale bound should match what B1 will render, which B1 has not decided. A conservative bound (long edge ≈ 1600 px) is used here; if B1 wants larger, the bound moves and previously uploaded images stay as they are.
- **Should an unreferenced-object sweep be filed as tech debt now, or wait for B6?** B6 adds a second bucket with the same orphan semantics. Filing one entry covering both after B6 is probably better than filing one now that B6 would have to rewrite.
