## Why

Phase 1a gave the owner everything the business needs to *describe itself internally* — locations, barbers, services, schedules, absences. None of it is addressable from outside. P1 is where the business acquires a public identity and a URL to hand out, and it is the gate to the entire public flow: B1 depends on it, and B2–B7 depend on B1.

It is also where the project meets **object storage** for the first time. The roadmap files that under "infrastructure stories hide inside feature stories" (roadmap.md:95) — Supabase Storage rides with P1 because P1 is the first upload. B6's transfer receipts will be the second, and they need a *private* bucket, so the storage contract written here has to be one that a private bucket can extend rather than one that assumes public reads.

And it is the first page whose audience is not the owner. A dashboard control that renders wrong is an annoyance the owner works around; the same defect on the public profile is the first thing a client sees. That is why `docs/tech-debt.md` T10 carries the trigger "now, and no later than P1".

## What Changes

- Add the `BusinessProfile` and `SocialLink` models and the `SocialPlatform` enum, per `docs/data-model.md` §2–§3. Purely additive.
- Add a profile editor at `/perfil`: business name, bio, profile image, cover image, up to seven social links, and the public slug — saved as one form.
- Add the first Supabase Storage integration: a **public** bucket for profile and cover images, written server-side **under the owner's own session** — no new privileged credential is introduced, and a bucket policy is what authorizes the write.
- Display the shareable link, `{origin}/b/{publicSlug}`, with a copy control.

Five decisions the owner has confirmed, each of which changes what gets built:

- **P1 displays the link; it does not make it resolve.** `decideGuardAction` is deny-by-default (`routeGuard.ts:40`), so `/b/**` redirects an anonymous visitor to `/login` until B1 opens it. The editor must say so in its own copy. Shipping a link that silently fails is worse than shipping no link, and the honest cheap version is a sentence.
- **The slug is editable, and changing it breaks every link already shared.** No alias or redirect table in this change — that is a second table and a story of its own. The editor warns at the point of change, which is the only moment the warning can land.
- **Images are downscaled in the browser before upload, to roughly 500 KB.** The alternative — accepting a 3–5 MB phone photo as-is — requires raising `serverActions.bodySizeLimit`, and that setting is **global**: it would also raise the accepted body size on `loginAction`, which is reachable unauthenticated and whose only current defence against large-body abuse is that limit. `loginThrottle` counts attempts, not bytes. A brand-page feature must not widen the auth surface, so the file is made small on the client instead and the limit is left alone.
- **Location metadata is stripped from uploaded images.** Phone photos carry GPS coordinates; publishing one publishes where it was taken. This costs nothing here — re-encoding a canvas to produce the downscaled file discards EXIF as a side effect — which is why it is decided now rather than deferred.
- **T10 is discharged in this change**, time-boxed, starting with the five-minute re-verification of the symptom that `docs/tech-debt.md:143` calls for, not with the CSS. Either it is fixed or its outcome is recorded; what does not happen is a fourth silent copy of the `<span>` workaround.

Two rules that fall out of the storage decision and are not obvious:

- **Images are uploaded before the transaction opens, never inside it.** Storage is not transactional and a network upload must not hold a database transaction open. The consequence is accepted deliberately: a database failure after a successful upload orphans the object. Orphans are logged and left; a save that fails because *cleanup* failed would cost the owner their work to reclaim a few hundred kilobytes.
- **An unchanged file input is not a removal.** A resubmitted form sends empty file fields, and mapping "no file" to `null` would silently delete both images every time the owner edits only the bio. Unchanged and removed are distinct signals on the wire.

## Capabilities

### New Capabilities
- `business-profile`: the owner edits the public profile and obtains the shareable link — the fields and their bounds, slug derivation and normalization, the whole-form replacement of the social-link set, the protocol allowlist on social URLs, the unpublished-link disclosure, the change-breaks-links warning, and the Spanish (es-AR) states of the form.
- `image-storage`: uploading an image the public flow will serve — the client-side downscale-and-strip contract, type and size validation by content rather than by declaration, an object key that no client input can steer, the credential boundary, replacement and orphan semantics, and the requirement that a real upload is proven on the deployment runtime before the feature is relied upon.

### Modified Capabilities
- `data-persistence`: the `BusinessProfile` and `SocialLink` models as single source of truth, the one-profile-per-owner and one-link-per-platform keys, slug uniqueness enforced by the database rather than by a read-then-write, the discrimination of the three distinct unique violations this change can raise, and the single transaction that replaces the social-link set.

## Impact

**Schema** — new `BusinessProfile` and `SocialLink` models, new `SocialPlatform` enum, migration `add_business_profile`; back-relation on `Owner`; both Prisma clients regenerated. Additive; no existing row is touched.

**Server layers** — new `IBusinessProfileRepository`, `IImageStorage`, `PrismaBusinessProfileRepository`, `BusinessProfileService`, `businessProfileSchema`, `BusinessProfileErrors`, and a `slugify` domain helper alongside `normalizeName`. New infrastructure folder `src/server/infrastructure/storage/`, which `backend-standards.md:142` already reserves.

**Presentation** — new route group `app/(dashboard)/perfil/`; a client-side image downscaler; modifications to `app/(dashboard)/layout.tsx` (nav entry) and `src/lib/copy.ts` (new `businessProfile` block).

**Configuration** — **no new secret.** Uploads run through the session-bound client the app already builds from `SUPABASE_URL` and `SUPABASE_ANON_KEY`; authorization comes from a storage access policy, not from a credential. This is what keeps `scripts/provision-owner.ts:7` true — the service-role key stays a one-off, passed inline, never a runtime credential of the Worker. `next.config.ts` is **not** modified either: leaving `bodySizeLimit` at its default is the point of the downscale decision.

**Runtime risk — the one that gates the change.** Whether a multipart upload survives a Server Action on `workerd` under OpenNext is not knowable from `next dev`; request buffering is exactly the class of thing S0 already found divergences in. A gate script proves an upload round-trip on the deployment runtime **before any UI is built**. The client-side downscale shrinks this risk to a few hundred kilobytes but does not eliminate it, and the fallback if the gate fails — a signed URL and a direct browser-to-Storage PUT — is a different design, which is why it is discovered first rather than last.

**Downstream** — unblocks B1, and through it the whole public flow. The `image-storage` capability is what B6 extends for receipts.

**Not affected** — `loginAction` and every other Server Action keep their current 1 MB body ceiling, which is the reason the downscale decision exists. The route guard is untouched: opening `/b/**` belongs to B1. No booking, payment, or catalogue behaviour changes.
