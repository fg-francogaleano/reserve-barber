// GATE P1 (part 1 of 2) — the storage bucket and its access policy behave as
// the design assumes, proven against real infrastructure rather than mocked.
//
// This is the half that can be proven from a script. The other half — whether a
// multipart body survives a Server Action on the `workerd` runtime — cannot be:
// it needs a built Worker and a browser. That one is driven manually under
// `opennextjs-cloudflare preview` (task 2.4).
//
// Writes run as the OWNER'S OWN SESSION, never as a service role. That is the
// whole point of design.md D13, so the gate signs in exactly the way the
// application will — which means it needs a real password.
//
// Credentials come from `scripts/.gate-credentials.json`, which is git-ignored:
//
//   { "email": "owner@example.com", "password": "…" }
//
//   npx tsx scripts/p1-gate.ts
//
// A file rather than the environment, and deliberately NOT `.env`/`.dev.vars`.
// Those are loaded by the application, and `scripts/provision-owner.ts:7`
// already sets the rule this follows: a credential the running app never needs
// must not live where the running app can read it. A file also keeps the
// password out of shell history and out of any transcript.
//
// Delete it when you are done. Environment variables still work as a fallback,
// for CI.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'public-profile';
const CREDENTIALS_FILE = resolve(process.cwd(), 'scripts/.gate-credentials.json');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface OwnerCredentials {
  email: string;
  password: string;
}

/**
 * Reads the owner's sign-in from the git-ignored file, falling back to the
 * environment.
 *
 * The error message names the file and shows its shape, because the alternative
 * is someone reaching for `.env` — which is the one place this must not go.
 */
function readOwnerCredentials(): OwnerCredentials {
  const fromEnv = { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD };
  if (fromEnv.email && fromEnv.password) {
    return { email: fromEnv.email, password: fromEnv.password };
  }

  let contents: string;
  try {
    contents = readFileSync(CREDENTIALS_FILE, 'utf8');
  } catch {
    throw new Error(
      `Missing ${CREDENTIALS_FILE}\n\n` +
        'Create it with the owner sign-in the gate should use:\n\n' +
        '  { "email": "owner@example.com", "password": "…" }\n\n' +
        'It is git-ignored. Delete it once the gate has run.\n' +
        'Do NOT put these in .env or .dev.vars — the application loads those.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${CREDENTIALS_FILE} is not valid JSON`);
  }

  const candidate = parsed as Partial<OwnerCredentials>;
  if (typeof candidate.email !== 'string' || typeof candidate.password !== 'string') {
    throw new Error(`${CREDENTIALS_FILE} must contain string "email" and "password" fields`);
  }

  return { email: candidate.email, password: candidate.password };
}

let failures = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

/**
 * The smallest thing that is genuinely a PNG: the 8-byte signature plus a
 * minimal IHDR/IDAT/IEND chain. Built as bytes rather than read from disk so the
 * gate has no fixture to lose, and so the leading-byte check the server will
 * perform has something real to recognise.
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const owner = readOwnerCredentials();

  // Session-bound client: anon key + a real sign-in, which is what the
  // application's `createSupabaseServerClient()` produces from cookies.
  const asOwner = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: session, error: signInError } = await asOwner.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });

  if (signInError || !session.user) {
    throw new Error(`Could not sign in as the owner: ${signInError?.message ?? 'no user returned'}`);
  }

  const authUserId = session.user.id;
  const ownKey = `${authUserId}/gate-${Date.now()}.png`;
  const foreignKey = `00000000-0000-0000-0000-000000000000/gate-${Date.now()}.png`;

  // ------------------------------------------------------------------ probe A

  const upload = await asOwner.storage
    .from(BUCKET)
    .upload(ownKey, ONE_PIXEL_PNG, { contentType: 'image/png' });

  report(
    'A the owner can write inside their own prefix',
    upload.error === null,
    upload.error ? upload.error.message : ownKey
  );

  // ------------------------------------------------------------------ probe B
  // The bucket is public, so the object must be readable with no credentials at
  // all — that is the property the whole public-bucket decision rests on.

  const publicUrl = asOwner.storage.from(BUCKET).getPublicUrl(ownKey).data.publicUrl;
  const publicRead = await fetch(publicUrl);

  report(
    'B a stored object is readable anonymously, with the content type it was written with',
    publicRead.status === 200 && publicRead.headers.get('content-type') === 'image/png',
    `${publicRead.status} ${publicRead.headers.get('content-type') ?? '(no content-type)'}`
  );

  // ------------------------------------------------------------------ probe C
  // The policy, not our validation, is what must refuse this. If it passes, the
  // key-composition rule is a promise rather than a guarantee and design.md D13
  // is wrong.

  const foreignWrite = await asOwner.storage
    .from(BUCKET)
    .upload(foreignKey, ONE_PIXEL_PNG, { contentType: 'image/png' });

  report(
    'C the database refuses a write outside the owner prefix',
    foreignWrite.error !== null,
    foreignWrite.error ? foreignWrite.error.message : 'ACCEPTED — the policy is not confining writes'
  );

  // ------------------------------------------------------------------ probe D

  const anonymous = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonWrite = await anonymous.storage
    .from(BUCKET)
    .upload(`${authUserId}/anon-${Date.now()}.png`, ONE_PIXEL_PNG, { contentType: 'image/png' });

  report(
    'D an unauthenticated write is refused',
    anonWrite.error !== null,
    anonWrite.error ? anonWrite.error.message : 'ACCEPTED — the bucket is writable by anyone'
  );

  // ------------------------------------------------------------------ probe E
  // A declared content type that contradicts the bytes must not be enough to
  // store something the bucket does not allow. This is the storage-level layer;
  // the server's own leading-byte check is the one that matters, and it is
  // tested separately.

  const wrongType = await asOwner.storage
    .from(BUCKET)
    .upload(`${authUserId}/gate-${Date.now()}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
      contentType: 'image/svg+xml',
    });

  report(
    'E the bucket refuses a disallowed mime type',
    wrongType.error !== null,
    wrongType.error ? wrongType.error.message : 'ACCEPTED — allowed_mime_types is not enforcing'
  );

  // ------------------------------------------------------------------ probe F
  // The authoritative question is whether the OBJECT is gone, not whether its
  // URL stops resolving.
  //
  // Two things this probe learned the hard way. First, a delete with no
  // matching SELECT policy removes nothing and reports no error, so checking
  // `error === null` proves nothing at all — `data` must be non-empty. Second,
  // the public URL keeps returning 200 for a while after a real delete, because
  // the object was already cached by the read in probe B. That is not a failure;
  // it is the behaviour the editor discloses to the owner.

  const removal = await asOwner.storage.from(BUCKET).remove([ownKey]);
  const removedCount = removal.data?.length ?? 0;

  report(
    'F a delete actually removes an object rather than silently matching none',
    removal.error === null && removedCount === 1,
    removal.error ? removal.error.message : `${removedCount} object(s) removed`
  );

  const listing = await asOwner.storage.from(BUCKET).list(authUserId);
  const stillListed = (listing.data ?? []).some((entry) => `${authUserId}/${entry.name}` === ownKey);

  report(
    'G the deleted object is gone from storage',
    listing.error === null && !stillListed,
    listing.error ? listing.error.message : stillListed ? 'still present' : 'absent'
  );

  // Recorded, never asserted. A 200 here means an intermediary is still serving
  // a copy of an object the database no longer has — which is precisely why the
  // editor tells the owner that publishing cannot be undone on demand.
  const afterRemoval = await fetch(publicUrl);
  console.log(
    `NOTE  the public URL returned ${afterRemoval.status} after deletion` +
      (afterRemoval.status === 200 ? ' — cached copy still being served, as expected' : '')
  );

  // Leave nothing behind if probe C unexpectedly succeeded.
  if (foreignWrite.error === null) {
    await asOwner.storage.from(BUCKET).remove([foreignKey]);
  }

  await asOwner.auth.signOut();

  console.log(failures === 0 ? '\nGATE PASSED' : `\nGATE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
