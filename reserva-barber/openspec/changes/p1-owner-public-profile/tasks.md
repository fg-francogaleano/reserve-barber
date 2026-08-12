## 1. Specification (spec-first, before any code)

- [x] 1.1 Reconcile `docs/data-model.md` §2–§3 with this change: confirm `BusinessProfile` and `SocialLink` as written still describe what is being built, and record the two rules the doc does not carry — `publicSlug` is normalized before persistence, and image URLs point at a public bucket
- [x] 1.2 Record in `docs/tech-debt.md`: unreferenced storage objects have no reaper (bounded, logged, revisit with B6), and slug changes have no alias/redirect path
- [x] 1.3 Note in `docs/tech-debt.md` T10 that its trigger has fired and this change carries it

## 2. Runtime gate — blocking, before any implementation

- [x] 2.1 Write `scripts/p1-gate.ts` following `m5b-gate.ts`: real storage, no mocks
- [x] 2.3 Gate: a storage object survives upload → unauthenticated read → delete. **Group 3 comes first** — this needs the bucket and its policy to exist
  - Run 1: probes A–E passed. **F failed and was worth every minute**: the delete reported success and removed nothing, because the bucket had no SELECT policy and the lookup preceding a delete matched no row. The probe also asserted the wrong thing — a public URL still returns 200 from cache after a real delete. Policy added, probe rewritten to check the object is actually gone.
  - Run 2 — **GATE PASSED**, all seven probes: A a write inside the owner prefix accepted; B the object readable anonymously as `200 image/png`; C a write outside the prefix refused by row-level security; D an anonymous write refused the same way; E `image/svg+xml` refused by the bucket; F the delete removed exactly one object; G the object confirmed absent from a listing. The public URL still returned 200 afterwards from cache — recorded as a note, never asserted, because it is the behaviour the editor discloses to the owner.

> The slug-constraint probe originally sat here as 2.2. It cannot: it needs the table, which group 4 creates. Moved to 4.6 rather than left as a step that could only be skipped.
- [x] 2.4 Gate: a multipart body reaches a Server Action intact under `opennextjs-cloudflare preview` — **not** `next dev`
  - **PASSED.** A 4.01 MB / 1400×1000 PNG was selected in a real browser against the Worker on `workerd`. The client re-encoded it to WEBP, the Server Action received it whole, and the object landed in storage: `{authUserId}/photo-…webp`, 739,470 bytes, `image/webp`, readable anonymously (200). The database row carries the matching URL.
  - **It also found a defect no unit test could see.** After the first successful save, every later save failed silently: the image slot stayed on `replace` while the browser emptied the file input, so validation rejected the whole form and reported an error against an image the owner had not touched. Fixed (success now carries a timestamp that returns the slots to `unchanged`), covered by two regression tests, and re-verified on the rebuilt Worker: a second save persisted the bio, the replacement wrote a new object, and the superseded object was deleted — which also confirms the SELECT policy from 3.2 works through the application, not only through the gate.
- [x] 2.5 **Decision point.** No re-plan needed: the transfer stays a Server Action, `serverActions.bodySizeLimit` stays at its default, and the signed-URL fallback is not used
  - Observation worth keeping: the re-encode landed at 722 KB against a 500 KB target, because the fixture is random noise and does not compress. A real photograph compresses far below this. The bound is a target, not a limit — the server ceiling is 5 MB and was never approached.

## 3. Storage bucket and access policy

- [x] 3.1 Create the public bucket for profile and cover images; confirm objects are readable without credentials
- [x] 3.2 Create the access policy: the authenticated role may insert, update and delete within the bucket, restricted to a leading path segment matching `auth.uid()`. Record the statement in the change so it can be recreated
- [x] 3.3 Confirm **no new secret was introduced** — `scripts/provision-owner.ts:7` and `.env.example` both forbid the service-role key at runtime, and this change must leave that true
- [x] 3.4 Prove the policy from both sides against real infrastructure — **done**: a write inside the owner prefix was accepted, the same write outside it was refused by row-level security, an anonymous write was refused, and a disallowed mime type was refused by the bucket

## 4. Schema and migration

- [x] 4.1 Add the `SocialPlatform` enum with exactly the platforms `docs/data-model.md` §3 names
- [x] 4.2 Add `BusinessProfile` with `@@unique` on `ownerId` and on `publicSlug`, `VarChar` bounds matching the data model, and the `Owner` back-relation as nullable
- [x] 4.3 Add `SocialLink` with `onDelete: Cascade`, `@@unique([businessProfileId, platform])`, `@@index([businessProfileId, orderIndex])`, and no `updatedAt`
- [x] 4.4 Create migration `add_business_profile`; confirm it is purely additive and touches no existing row
- [x] 4.5 Regenerate both Prisma clients and confirm `typecheck` passes
- [x] 4.6 Gate (moved from 2.2, needs the table): a duplicate `publicSlug` insert raises `P2002`, names the slug constraint in its metadata, and leaves the existing row untouched; a duplicate `ownerId` insert raises `P2002` naming a *different* constraint, which is what makes the three-way discrimination testable

## 5. Domain layer

- [x] 5.1 Failing tests for `slugify`: diacritics stripped, lowercased, non-alphanumeric runs collapsed, leading/trailing hyphens trimmed, "Barbería Don Juan" → "barberia-don-juan", input that collapses to empty
- [x] 5.2 Implement `src/server/domain/models/slugify.ts` beside `normalizeName.ts` — pure, no dependencies
- [x] 5.3 Create the `BusinessProfile` and `SocialLink` domain models and the `SocialPlatform` type
- [x] 5.4 Create `IBusinessProfileRepository`, every method taking `ownerId`
- [x] 5.5 Create `IImageStorage` — upload and delete, returning key and resolved URL, with no assumption of public readability so B6's private bucket can implement it
- [x] 5.6 Create `BusinessProfileErrors`: duplicate slug, profile-already-exists, duplicate platform, unsupported image type, image too large, upload failed

## 6. Application layer — validation (TDD)

- [x] 6.1 Failing tests for the name: normalized, 2–120, whitespace-or-punctuation-only rejected as required
- [x] 6.2 Failing tests for the bio: blank stored as null, over 1000 rejected, an astral-plane string over the code-unit bound rejected before the database
- [x] 6.3 Failing tests for the slug: normalized before validation, 3–60, pattern enforced, doubled/leading/trailing hyphens rejected, a submitted display string normalized to its canonical form
- [x] 6.4 Failing tests for social URLs: `javascript:` rejected, unparseable rejected, `http`/`https` accepted, over 500 rejected — protocol checked via `new URL()`, never a pattern
- [x] 6.5 Failing tests for the link set: fully blank rows discarded, half-filled rows rejected, duplicate platforms rejected, more than seven rejected
- [x] 6.6 Failing tests for image intent: unchanged / replace / remove parsed as three distinct states, and an absent file never read as a removal
- [x] 6.7 Implement `src/server/application/businessProfile/businessProfileSchema.ts` until 6.1–6.6 pass, following the `ParseResult<T>` and field-error shape of `serviceSchema.ts`

## 7. Application layer — service (TDD)

- [x] 7.1 Failing tests for `BusinessProfileService`: first save creates, later save updates the same row, both through one code path
- [x] 7.2 Failing tests: images upload before the transaction opens; a transaction failure after a successful upload logs the unreferenced key and reports the database failure
- [x] 7.3 Failing tests: a replaced image deletes its predecessor, and a failed delete does not fail the save
- [x] 7.4 Failing tests: unchanged image intent uploads nothing, deletes nothing, and preserves the stored URLs
- [x] 7.5 Failing tests: the service receives **domain** errors from the repository and maps them to outcomes — it never inspects a Prisma error shape (moved to 8.5; see design D8 as rewritten after the gate)
- [x] 7.6 Implement `BusinessProfileService.ts` with repository and storage injected by constructor

## 8. Infrastructure — persistence (TDD)

- [x] 8.1 Failing test: the read fetches profile and links in one owner-scoped query ordered by `orderIndex`, with no N+1
- [x] 8.2 Failing test: a foreign `ownerId` resolves as absent
- [x] 8.3 Failing test: the save is one transaction — upsert profile, delete links, create links — and a failed link insert rolls the profile write back
- [x] 8.4 Failing test: a retried save leaves the link set equal to the submitted set, with no duplicates
- [x] 8.5 Failing tests for constraint translation **in the repository**: `ownerId` → `ProfileAlreadyExistsError`, `publicSlug` → `DuplicateSlugError`, `businessProfileId,platform` → `DuplicatePlatformError`, anything else rethrown untouched. Read from `meta.driverAdapterError.cause.constraint.fields`, stripping the quotes the driver includes — **not** `meta.target`, which does not exist on this stack (proven by `scripts/p1-gate-db.ts`)
- [x] 8.6 Implement `PrismaBusinessProfileRepository.ts`, so that nothing Prisma-shaped leaves the infrastructure layer

## 9. Infrastructure — storage (TDD)

- [x] 9.1 Failing tests for content-based type detection: JPEG, PNG and WEBP signatures accepted; a text file declaring `image/png` rejected; the stored content type taken from the bytes
- [x] 9.2 Failing test for the server-side size bound, enforced independently of any client reduction
- [x] 9.3 Failing tests for key composition: every segment server-held; the leading segment is the auth user id, not the domain owner id; a filename carrying path separators and parent-directory segments cannot escape the owner prefix; a replacement never reuses a key
- [x] 9.4 Failing test: a storage failure surfaces as an infrastructure error and logs operation, cause and key — never submitted business data
- [x] 9.5 Failing test: the adapter uploads through the injected session-bound client and never constructs a privileged one; an absent `authUserId` is refused rather than defaulted
- [x] 9.6 Implement `src/server/infrastructure/storage/SupabaseImageStorage.ts`, taking the session-bound client by injection

## 10. Presentation — client image pipeline (TDD)

- [x] 10.1 Failing tests for the downscale: a large image is re-encoded within the target size and bounded dimension; an undecodable file is refused on the client with a message and nothing is transmitted
- [x] 10.2 Failing test: the re-encoded output carries none of the source's embedded metadata
- [x] 10.3 Implement the client-side downscale-and-re-encode module
- [x] 10.4 Confirm `next.config.ts` is unmodified — no Server Action body-size override was introduced

## 11. Presentation — editor (TDD)

- [x] 11.1 Add the `businessProfile` block to `src/lib/copy.ts` in es-AR, including the unpublished-link disclosure, the slug-change warning, the irreversible-publication note, and the do-not-close-this-tab pending copy
- [x] 11.2 Failing tests for `formState.ts`: field errors mapped, submitted values preserved on infrastructure failure
- [x] 11.3 Failing tests for `actions.ts`: `requireOwner()` resolves before parse, upload or persist
  - Written expecting a separate remove action; there is none, and there should not be. Removal travels as an intent on the same submit (D4), so `saveBusinessProfileAction` is the whole action surface and the single authorization boundary. Corrected during verification rather than left claiming coverage of something that does not exist.
- [x] 11.4 Failing tests for `actions.ts`: validation failures return field errors with no upload and no transaction; the action returns a success state and does not redirect
- [x] 11.5 Implement `app/(dashboard)/perfil/actions.ts` with `revalidatePath('/perfil')`
- [x] 11.6 Failing tests for `page.tsx`: renders an empty form when no profile exists; anonymous access redirects to `/login?next=%2Fperfil`
- [x] 11.7 Implement `page.tsx` and `loading.tsx`
- [x] 11.8 Failing tests for `ProfileForm.tsx`: pending state disables submission and shows the do-not-close copy; field errors are associated with their inputs; previews render at the public aspect ratio and revoke their object URLs
- [x] 11.9 Failing tests for the slug field: suggestion derived as the name is typed; the warning appears only when a stored slug is altered
- [x] 11.10 Implement `ProfileForm.tsx`
- [x] 11.11 Failing tests for `ShareableLink.tsx`: the origin is server-resolved with no hydration mismatch; a successful copy is confirmed; an unavailable clipboard leaves the link selectable and fails visibly
- [x] 11.12 Implement `ShareableLink.tsx`
- [x] 11.13 Add the "Mi perfil" entry to `app/(dashboard)/layout.tsx`
- [x] 11.18 Failing tests for the slug reconciling with what was stored, per D10 as extended: a successful save echoes the canonical slug, the field adopts it, and the change warning clears — including when the stored slug did not change because the typed value normalized onto it
  - Three tests: the action echoes the canonical slug on success, still echoes the raw text on rejection (which is the one case the owner needs it back to correct), and the form adopts it and drops the warning.
  - **Fixing this broke an unrelated test, and the break was informative.** "submits a row added during the session" mocked a success carrying an empty `publicSlug` — a state the real action cannot produce. The form dutifully adopted the empty slug, and the browser's `required` then blocked the second submit. The mock was wrong, not the fix; it now carries a slug like the real one does.
- [x] 11.19 Echo the canonical slug on success and adopt it on the `savedAt` transition; correct the claim in `actions.ts` that revalidating already reconciles this
  - The old comment claimed `revalidatePath` reconciled the typed slug with the canonical one. It never could: the case that exposed this does not change the stored value at all, so there is nothing for a revalidated tree to carry.
  - Re-verified on the deployed Worker (`d4f6c403`) with the exact reproduction: typing `Barberia Don Juan Centro` over the identical stored slug now saves and leaves the field showing `barberia-don-juan-centro`, agreeing with the link, with no warning. A **real** slug change still raises the warning, and restoring the stored value still clears it — the warning was reconciled, not silenced.
- [x] 11.16 Failing tests for the preparation window, per D4 as extended: submission is blocked while a slot is being prepared, `imageProcessing` is disclosed, and both are released once every slot has settled
  - Driven by a pipeline whose `process` is held open, so the gap can be inspected instead of raced.
- [x] 11.17 Block submission while any image slot is preparing, rendering `COPY.businessProfile.imageProcessing` — the copy has existed since 11.1 with nothing rendering it
  - The slot carries a `preparing` flag raised **before** the await, because the gap opens the instant the file lands in the input.
- [x] 11.14 Failing tests for the social rows across an action boundary, per D7 as rewritten: a row added during the session still carries its platform and URL after a successful save, and a rejected save re-renders every row with the values that were submitted
  - Both failed first, so the reset is reproducible in jsdom after all — the earlier D4 finding had suggested only a real browser could see this class of defect.
- [x] 11.15 Make the social rows controlled so React's post-action form reset cannot revert them, and confirm the whole-set replacement in D7 can no longer discard a stored link
  - **Controlling the value was necessary but not sufficient, and only measurement settled it.** React restores a controlled text input after the reset; it does not restore a `<select>`, whose `value` prop is unchanged from the previous render, so nothing is written and the element keeps reporting `""`. The first save carried `WHATSAPP` and the second carried `""` with the URL already intact — the defect surviving the obvious fix. The selects are now written back from state after every commit, which is the commit the reset rides in on.
  - Re-verified in the browser on `next dev`, repeating the exact sequence that found it: added WHATSAPP, saved, then saved again without touching the form. The row kept its platform, `updatedAt` advanced, and both links survived.

## 12. Tech debt T10 — time-boxed

- [x] 12.1 Re-verify the symptom first, per `docs/tech-debt.md:143` — the inspecting extension is a live explanation and this is a five-minute check
- [x] 12.2 If it reproduces, read the generated stylesheet from the build output rather than the live DOM, as the entry recommends
- [x] 12.3 Fix it, or record the finding in the T10 entry and stop. A fourth undocumented copy of the inner-`<span>` workaround is not an acceptable outcome

## 13. Verification and delivery

- [x] 13.1 `npx vitest run` — the 668 existing tests still pass alongside the new ones
  - **901 tests across 69 files, all passing.** The 668 that existed before this change are among them; P1 added 233.
- [x] 13.2 `npm run typecheck` and `npm run lint` clean
  - Both silent: `tsc --noEmit` and `eslint` reported nothing.
- [x] 13.3 `npm run test:coverage` — 90% branches, functions, lines and statements on domain and application layers
  - **97.7% statements, 93.68% branches, 98.46% functions, 98.24% lines.** The thresholds are global and scoped to `src/server/domain/**` and `src/server/application/**` only, so component tests cannot inflate them.
- [x] 13.4 Verify on `next dev`: create a profile, edit only the bio and confirm both images survive, replace an image, remove an image, change the slug and see the warning
  - Create: the row, both WEBP objects and an Instagram link were written in one save. The slug field followed the name as it was typed — "Barbería Don Juan" offered `barberia-don-juan` — and the pending state showed both the disabled button and the do-not-close-this-tab copy.
  - Edit only the bio: both stored URLs came back byte-identical and the link survived, so D4 holds through a real submit.
  - Replace: a new key (`photo-…915561.webp`, 9,144 bytes, `RIFF/WEBP`) readable anonymously, and the predecessor now answers 400 — the delete reached the object, not just the row.
  - Remove: `coverUrl` set to null and its object answers 400.
  - Slug change: the warning appeared as soon as a stored slug was altered, and the old address stopped resolving after the save.
  - **This step also found the social-row defect fixed in 11.14–11.15**, which is the reason the step exists.
  - One attempt combined a replace, a remove and a slug change in a single save and everything applied except the replace. Chased to the end and **it was not a product defect**: the `change` event had landed on a page React had not hydrated yet, so the handler never ran and the slot never left `unchanged`. See the note under 13.5 — driving a background tab is what made this reachable, and no person can hit it.
  - **It did lead somewhere real, though.** Looking for the cause is what exposed the preparation window fixed in 11.16–11.17: the client raises the intent only after re-encoding, and a save sent before that carries `unchanged` alongside the original file.
- [x] 13.5 Verify on `opennextjs-cloudflare preview`: a real upload through the editor, end to end
  - A 2400×1800 PNG (841,205 bytes) went through the editor on `workerd`: re-encoded to `upload.webp`, saved, stored as `photo-…358121.webp` and readable anonymously as `image/webp`. The predecessor answers 400, the untouched cover kept its URL, and both social links survived — one save exercising replace, preserve and the whole-set link write together.
  - The preparation window from 11.16–11.17 was **measured here before and after the fix**: 1,689 ms with the save button enabled and nothing disclosed, against 1,492 ms with submission blocked and `imageProcessing` on screen.
  - **A note for whoever verifies the next story.** A background tab does not hydrate: React defers the work while `document.visibilityState` is `hidden`, so a driven page renders its SSR HTML and answers no events — the file input accepts a file and the handler never runs. It looks exactly like a broken client build, and it cost real time here. Take a screenshot first; that forces the render and hydration follows. The layout hydrates before the page subtree, so the nav responding proves nothing about the form.
- [x] 13.6 Verify on the deployed Worker with the secret set, and confirm the stored image is publicly readable
  - Deployed as version `6baaae75-5cde-4d69-be31-879331ab1470`. Unauthenticated surface first: `/`, `/perfil` and `/b/{slug}` all answer 307 to `/login` carrying their `next`, a corrupt session cookie fails closed rather than 500, and `/login` renders its es-AR copy.
  - Signed in, an image went through the editor end to end: stored as `photo-…515791.webp`, fetched anonymously as **200 `image/webp`, 9,144 bytes, `RIFF/WEBP`** — the same bytes the browser produced. The predecessor answers 400, the untouched cover kept its URL, and both social links survived.
  - The link rendered as `https://reserva-barber.franco-galeano.workers.dev/b/barberia-don-juan-centro` — a third distinct origin for the same profile, which is D11 holding in production.
  - No new secret was needed for any of this: the upload runs as the owner's own session (D13).
- [x] 13.7 Confirm the shareable link renders correctly and that following it still redirects to `/login` — B1 has not shipped, and the disclosure copy must match the behaviour
  - The link is built from the request origin, not a constant: the same profile rendered `http://localhost:3000/b/…` on Node and `http://127.0.0.1:8787/b/…` on the Worker, which is D11 holding at runtime.
  - Following it answers `307 → /login?next=%2Fb%2Fbarberia-don-juan-centro` on both runtimes, so `linkNotPublishedYet` describes what actually happens. The superseded slug redirects the same way, which is the concrete form of the warning shown when a slug changes.
- [x] 13.8 Update `docs/roadmap.md`: tick P1
  - Recorded what P1 carried beyond its own story: the Storage setup and its policy, and the fact that the shareable link stays unresolvable until B1.
- [x] 13.9 Update `docs/tech-debt.md` with T10's outcome and any debt this change filed
  - T10 carries its mechanism now (unlayered CSS beats every Tailwind v4 utility, almost certainly injected by a browser extension) and is down to **one 30-second human check** — a dashboard page opened with extensions disabled. It is the only thing this change leaves for someone else to run.
  - T32 (unreferenced objects) and T33 (slug changes break shared links) were filed with the change, per 1.2.
  - **T34 added:** the controlled `<select>` needs a manual write-back after React's post-action reset. Filed because the rule is invisible — the next action-backed `<select>` in this project will hit it and nothing in the types will warn.
