-- B6 — transfer receipts: private bucket, predicate and access policies.
--
-- NOT a Prisma migration. Prisma owns the `public` schema; buckets and their
-- policies live in Supabase's `storage` schema, which Prisma does not track and
-- therefore never reports as drift. Applied as a Supabase migration
-- (`b6_transfer_receipts_bucket_and_policies`) and recorded here so the
-- infrastructure is reproducible from the repository rather than only from the
-- dashboard. This is the same arrangement P1 established for `public-profile`.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DIFFERENT HERE, AND WHY IT NEEDED A NEW MECHANISM
-- ---------------------------------------------------------------------------
--
-- P1's guarantee is a property of the database: its policies compare the key's
-- leading segment against `auth.uid()`, so a write outside the owner's own
-- prefix is refused by Postgres rather than by application code. That works
-- because the uploader IS the owner, holding a session.
--
-- The uploader here is a booking guest with no session and no `auth.uid()`.
-- There is nothing to compare against, so the same policy shape cannot be
-- written — P1's file promised B6 "the same policy shape", and that promise is
-- kept in spirit and not in form.
--
-- What replaces it (design D1): the insert policy admits the `anon` role ONLY
-- through `public.storage_can_accept_receipt()`, which re-derives the same
-- guarantee from the application's own data — the key must name a real booking,
-- in a state that is still accepting a receipt, under that booking's real
-- owner. A bare `anon` insert grant was rejected: the key that authorizes it is
-- designed to be published, so the first story that adds a browser-side
-- Supabase client would silently make this bucket world-writable, and a policy
-- that admits every caller reads as protection while protecting nothing.
--
-- Idempotent: safe to re-run against a project that already has it.

-- ---------------------------------------------------------------- the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transfer-receipts',
  'transfer-receipts',
  -- PRIVATE. P1's bucket is public because its images are rendered to
  -- unauthenticated clients on every page view; that reasoning does not extend
  -- to a document carrying a client's bank details. The owner reads through a
  -- short-lived signed URL created with their own session.
  false,
  -- 10 MB. The third layer, not the only one: the route refuses on
  -- `Content-Length` before reading the body, then re-checks the actual byte
  -- length because that header is client-controlled.
  10485760,
  -- Banks issue PDF comprobantes, so PDF joins the two image types. SVG is
  -- excluded for the reason `imageType.ts` records, and the exclusion holds
  -- even though this bucket is private: the file is later opened in the
  -- owner's own browser.
  --
  -- NOTE this list checks the DECLARED content type, which is client-supplied.
  -- It is a backstop. The type that decides anything is detected from the
  -- file's leading bytes in `receiptFileType.ts`.
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------- the predicate

-- Whether an anonymous insert at `object_path` is admissible.
--
-- Expected key shape (composed entirely of server-held values in
-- `TransferReceipt.ts`):
--
--   {ownerAuthUserId}/{bookingId}/{uploadedAtEpochMs}.{ext}
--
-- SECURITY DEFINER is what lets this read the application's tables without
-- granting the `anon` role any privilege on them. `search_path` is pinned so a
-- caller cannot shadow `public` or `pg_catalog` with objects of their own —
-- without that, SECURITY DEFINER is a privilege-escalation primitive rather
-- than a check.
--
-- ---------------------------------------------------------------------------
-- COLUMNS THIS DEPENDS ON, AND WHY THEY ARE LISTED
-- ---------------------------------------------------------------------------
-- Prisma owns these tables and never reports this file as drift, so a rename
-- breaks the predicate with no warning anywhere. `scripts/b6-gate.ts` inserts
-- as the `anon` role with a non-existent booking id and requires the refusal,
-- so the breakage surfaces in the gate rather than as an incident.
--
--   "Booking"  . id, barberId, status, holdExpiresAt
--   "Barber"   . id, locationId
--   "Location" . id, ownerId
--   "Owner"    . id, authUserId
--
-- The owner is reached through the barber: a booking's location is deliberately
-- not duplicated on the row (data-model.md §11), so this join is the only path.

create or replace function public.storage_can_accept_receipt(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from "Booking"  b
    join "Barber"   br on br.id = b."barberId"
    join "Location" l  on l.id  = br."locationId"
    join "Owner"    o  on o.id  = l."ownerId"
    where b.id = (storage.foldername(object_path))[2]
      -- `authUserId` is nullable at the column level, and a null must FAIL
      -- rather than match. `=` against null yields null, which `exists` treats
      -- as no row — correct here, and stated because it is easy to misread.
      and o."authUserId" is not null
      and o."authUserId" = (storage.foldername(object_path))[1]
      and (
        -- A first upload: the hold is still live. Half-open, matching
        -- `blocksAvailability` — the expiry instant itself is past it.
        (b.status = 'PENDING_PAYMENT' and b."holdExpiresAt" > now())
        -- A replacement: the booking has already moved to PENDING_APPROVAL and
        -- the client is correcting a wrong photo before it is reviewed. Without
        -- this branch the replacement rule would be unimplementable, since the
        -- hold deadline has stopped governing by then.
        or b.status = 'PENDING_APPROVAL'
      )
  );
$$;

-- The function reads owner-scoped rows, so it must not be callable as a probe
-- by anyone who is not going through the policy. Revoke the default, then grant
-- exactly the two roles the policies evaluate as.
revoke all on function public.storage_can_accept_receipt(text) from public;
grant execute on function public.storage_can_accept_receipt(text) to anon, authenticated;

-- -------------------------------------------------------------- the policies

-- INSERT — anonymous, and admitted only by the predicate above. This is the
-- one policy in this project that authorizes a caller with no session.
drop policy if exists "transfer_receipt_anon_insert" on storage.objects;
create policy "transfer_receipt_anon_insert"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'transfer-receipts'
    and public.storage_can_accept_receipt(name)
  );

-- SELECT — the owner, confined to their own prefix, exactly as P1 does.
--
-- REQUIRED FOR DELETE TO WORK AT ALL, and this is measured rather than assumed:
-- P1's probe F found that Supabase Storage looks an object up before removing
-- it, so with no SELECT policy the lookup finds nothing, the delete removes
-- nothing, and the API returns NO ERROR. Every receipt replacement would
-- silently keep its predecessor forever.
--
-- The prefix is the SUPABASE AUTH user id, not the Prisma `Owner.id` — distinct
-- values, and only the former is what `auth.uid()` can be compared against.
--
-- `(select auth.uid())` rather than a bare call: evaluated once per statement
-- instead of once per row.
drop policy if exists "transfer_receipt_owner_select" on storage.objects;
create policy "transfer_receipt_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'transfer-receipts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- DELETE — the owner, confined to their own prefix. Used by the replacement
-- path, which runs as the owner-scoped adapter rather than as the guest.
drop policy if exists "transfer_receipt_owner_delete" on storage.objects;
create policy "transfer_receipt_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'transfer-receipts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- NO UPDATE POLICY, for either role, deliberately. A replacement is
-- delete-then-insert with a new key carrying a new instant, so nothing ever
-- needs to overwrite an object in place — and `anon` holding an update grant
-- would let a receipt already under review be swapped underneath the owner.

-- NO ANONYMOUS READ of any kind. The bucket is private, `anon` has no select
-- policy, and there is no public object endpoint for it. An object is reachable
-- only through a signature the owner's session creates.
