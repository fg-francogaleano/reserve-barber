-- P1 — public profile images: bucket and access policies.
--
-- NOT a Prisma migration. Prisma owns the `public` schema; buckets and their
-- policies live in Supabase's `storage` schema, which Prisma does not track and
-- therefore never reports as drift. Applied as a Supabase migration
-- (`p1_public_profile_bucket_and_policies`) and recorded here so the
-- infrastructure is reproducible from the repository rather than only from the
-- dashboard.
--
-- Two decisions this file encodes, both from design.md:
--
--   D12/D13 — the bucket is PUBLIC because these images are rendered to
--   unauthenticated clients in the booking flow, where signing a URL on every
--   render would be the wrong mechanism. That reasoning does not extend to
--   transfer receipts (B6), which get their own private bucket with the same
--   policy shape and no public read.
--
--   D13 — writes are authorized by the OWNER'S OWN SESSION, never by a
--   service-role key. `scripts/provision-owner.ts:7` and `.env.example` both
--   forbid storing that key in the application environment, because it bypasses
--   row-level security across the entire database. This change introduces no
--   new secret.
--
-- Idempotent: safe to re-run against a project that already has it.

-- ---------------------------------------------------------------- the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-profile',
  'public-profile',
  true,
  -- 5 MB. The third layer, not the only one: the browser downscales to roughly
  -- 500 KB before upload, and the server checks the size again independently of
  -- whatever the client did.
  5242880,
  -- SVG is excluded deliberately: an SVG served from a public origin is a
  -- script-execution surface. Type is also verified server-side by inspecting
  -- the file's leading bytes, because a declared MIME type is client-controlled.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------- the policies

-- The leading path segment MUST equal the caller's auth user id. That is what
-- makes the key-composition rule enforceable by the database rather than
-- promised by application code: a write outside the owner's own folder is
-- refused here, independently of any validation we perform.
--
-- The prefix is the SUPABASE AUTH user id, not the Prisma `Owner.id`. They are
-- distinct values (`Owner.authUserId` maps one to the other), and only the
-- former is what `auth.uid()` can be compared against.
--
-- `(select auth.uid())` rather than a bare call: the subquery is evaluated once
-- per statement instead of once per row.

drop policy if exists "public_profile_owner_insert" on storage.objects;
create policy "public_profile_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'public-profile'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "public_profile_owner_update" on storage.objects;
create policy "public_profile_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'public-profile'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'public-profile'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "public_profile_owner_delete" on storage.objects;
create policy "public_profile_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'public-profile'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- REQUIRED FOR DELETE TO WORK AT ALL. Not obvious, and measured rather than
-- assumed: this file originally declared no SELECT policy, on the reasoning that
-- public reads go through the public object endpoint and never consult row-level
-- security. That reasoning is correct about reading and wrong about deleting.
--
-- Supabase Storage looks an object up before removing it. With no SELECT policy
-- the lookup finds nothing, the delete removes nothing, and the API returns
-- **no error** — a silent no-op. Every image replacement would have left its
-- predecessor behind forever, which is a different and much worse problem than
-- the bounded orphan case `docs/tech-debt.md` T32 accepts. Probe F of
-- `scripts/p1-gate.ts` is what caught it.
--
-- Confined to the owner's own prefix like the write policies: this exists for
-- the authenticated API path (delete, list), not to gate public reads, which it
-- does not affect.
drop policy if exists "public_profile_owner_select" on storage.objects;
create policy "public_profile_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'public-profile'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
