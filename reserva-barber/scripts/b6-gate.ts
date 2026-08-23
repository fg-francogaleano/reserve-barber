// GATE B6 — the transfer path against the live database and the real bucket.
//
// Two of this change's guarantees exist **only** in infrastructure, and no unit
// test in this repository can see either of them:
//
//   1. **The `SECURITY DEFINER` predicate.** B6 gives an anonymous caller an
//      insert grant on a bucket, which is the first time anything in this
//      product has done that. What confines it is not application code — it is
//      `public.storage_can_accept_receipt()`, which resolves the object key
//      against `Booking → Barber → Location → Owner` and admits the write only
//      where it names a real booking, in a live hold, under its real owner.
//      That predicate reads tables **Prisma owns and never reports as drift**,
//      so a column rename breaks it silently. Probes 11.1 and 11.2 are the only
//      thing that would notice.
//
//   2. **The transactional writes.** B4 shipped an advisory lock that had never
//      once worked — `pg_advisory_xact_lock` returns `void` and the pg adapter
//      cannot deserialize it — past a test that mocked `$queryRaw` and asserted
//      the call. The receipt write and the approval both take that same lock.
//      A mock cannot certify them for exactly the reason T58 records.
//
// Everything it creates is prefixed `__b6_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
// It needs the owner's sign-in, like `p1-gate.ts`, because the owner-scoped
// read is half of what is being proven. Put it in `scripts/.gate-credentials.json`
// (git-ignored) or pass OWNER_EMAIL / OWNER_PASSWORD inline. **Not in `.env`** —
// the application loads that.
//
//   npx tsx scripts/b6-gate.ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaTransferReceiptRepository } from '../src/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { PrismaPaymentRepository } from '../src/server/infrastructure/prisma/PrismaPaymentRepository';
import { PrismaBookingRepository } from '../src/server/infrastructure/prisma/PrismaBookingRepository';
import { detectReceiptType, MAX_RECEIPT_BYTES } from '../src/server/domain/models/receiptFileType';
import { receiptObjectKey } from '../src/server/domain/models/TransferReceipt';
import { blocksAvailability } from '../src/server/domain/models/Booking';
import { TRANSFER_HOLD_DURATION_MINUTES } from '../src/server/domain/models/bookingHorizon';

const MARK = '__b6_gate__';
const BUCKET = 'transfer-receipts';

/**
 * The same path `p1-gate.ts` uses, and the path matters.
 *
 * `.gitignore` ignores `scripts/*gate-credentials*.json` — matched loosely on
 * purpose, because a file holding a password must not become committable
 * because somebody dropped the leading dot, which is what happened the first
 * time. A file at the repository root would match none of those patterns.
 */
const CREDENTIALS_FILE = resolve(process.cwd(), 'scripts/.gate-credentials.json');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readOwnerCredentials(): { email: string; password: string } {
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

  const parsed = JSON.parse(contents) as { email?: string; password?: string };
  if (!parsed.email || !parsed.password) {
    throw new Error(`${CREDENTIALS_FILE} must contain both "email" and "password"`);
  }
  return { email: parsed.email, password: parsed.password };
}

let failures = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

/** An open question. Reported, never counted as a failure — it has no expected answer. */
function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

/**
 * A probe that could not run, counted as a failure.
 *
 * **Not a pass.** The first run of this gate reported six green lines against a
 * bucket that did not exist, because every negative storage probe asserts "the
 * write was refused" and a missing bucket refuses everything. Green for the
 * wrong reason is worse than red: it is the same failure mode this change
 * refused for `validateSignature()` in T60 — a check that reads as protection
 * while protecting nothing.
 */
function skip(probe: string, reason: string): void {
  console.log(`SKIP  ${probe} — ${reason}`);
  failures += 1;
}

/**
 * Whether a storage error is the policy refusing, rather than the bucket being
 * absent or misnamed.
 *
 * The distinction is the whole point of the negative probes. "Bucket not found"
 * and "new row violates row-level security policy" are both errors and mean
 * opposite things: the first says the infrastructure is missing, the second
 * says it is working. Asserting only that *an* error occurred cannot tell them
 * apart — and a typo in the bucket name would then make every confinement probe
 * pass forever.
 *
 * **Only the bucket is excluded, and "Object not found" is deliberately NOT.**
 * Measured on the second run: an anonymous read of an object the caller has no
 * `select` policy for comes back as `Object not found`, not as a refusal. That
 * is row-level security working exactly as it should — the row is invisible, so
 * the lookup finds nothing — and it is the **better** answer of the two, since
 * a `403` would confirm to a stranger that a given receipt exists. An earlier
 * version of this function matched any "not found" and failed that probe for
 * being correct.
 */
function refusedByPolicy(error: { message: string } | null): boolean {
  if (error === null) return false;
  return !/bucket not found/i.test(error.message);
}

// ---------------------------------------------------------------- fixtures
//
// Real leading bytes, because the whole point of the type rules is that they
// read the file rather than believing what it is called.

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082',
  'hex'
);
const JPEG_BYTES = Buffer.concat([
  Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
  Buffer.alloc(64),
  Buffer.from('ffd9', 'hex'),
]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const credentials = readOwnerCredentials();

  /** The sessionless client the public route uses. */
  const anonymous: SupabaseClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /** The owner's own session, which is what the review surface holds. */
  const asOwner: SupabaseClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: session, error: signInError } = await asOwner.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (signInError || !session.user) {
    throw new Error(`Could not sign in as the owner: ${signInError?.message ?? 'no user'}`);
  }
  const authUserId = session.user.id;

  const createdIds: Record<string, string | undefined> = {};
  const uploadedKeys: string[] = [];

  try {
    // ================================================================ schema
    // A constraint that exists and does not bind is worse than none, because
    // the code above it stops checking.
    {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'TransferReceipt'
      `;
      const names = columns.map((c) => c.column_name).sort();
      const required = [
        'filePath',
        'id',
        'paymentId',
        'reviewedAt',
        'status',
        'uploadCount',
        'uploadedAt',
      ];
      const missing = required.filter((column) => !names.includes(column));
      report(
        '11.0a. TransferReceipt exists with every column the code writes',
        missing.length === 0,
        missing.length === 0 ? names.join(', ') : `missing: ${missing.join(', ')}`
      );
    }

    {
      // `Timestamptz`, not the zone-less default. B3 measured what happens when
      // an instant loses its zone, and every column since has carried one.
      const types = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'TransferReceipt' AND column_name IN ('uploadedAt', 'reviewedAt')
      `;
      const zoned = types.filter((t) => t.data_type === 'timestamp with time zone');
      report(
        '11.0b. Both receipt instants are zone-aware',
        zoned.length === 2,
        types.map((t) => `${t.column_name}=${t.data_type}`).join(', ')
      );
    }

    const fn = await prisma.$queryRaw<{ proname: string; prosecdef: boolean; cfg: string[] }[]>`
      SELECT proname, prosecdef, proconfig AS cfg
      FROM pg_proc WHERE proname = 'storage_can_accept_receipt'
    `;
    {
      const found = fn[0];
      report(
        '11.0c. The insert predicate exists, is SECURITY DEFINER and pins its search_path',
        found !== undefined &&
          found.prosecdef === true &&
          (found.cfg ?? []).some((entry) => entry.startsWith('search_path=')),
        found === undefined
          ? 'function absent — the anon insert policy has nothing to call'
          : `secdef=${found.prosecdef} config=${JSON.stringify(found.cfg)}`
      );
    }

    const bucket = await prisma.$queryRaw<
      { id: string; public: boolean; file_size_limit: bigint | null }[]
    >`SELECT id, public, file_size_limit FROM storage.buckets WHERE id = ${BUCKET}`;
    {
      const found = bucket[0];
      report(
        '11.0d. The bucket exists and is private',
        found !== undefined && found.public === false,
        found === undefined ? 'bucket absent' : `public=${found.public}`
      );
      report(
        '11.0e. The bucket enforces its own size ceiling',
        found !== undefined && Number(found.file_size_limit ?? 0) === MAX_RECEIPT_BYTES,
        `file_size_limit=${found?.file_size_limit ?? 'null'} (expected ${MAX_RECEIPT_BYTES})`
      );
    }

    /**
     * Whether the storage half of this change is deployed at all.
     *
     * **Everything downstream is gated on this**, because a missing bucket
     * refuses every write — and every negative storage probe below asserts that
     * a write was refused. The first run of this gate reported six green lines
     * that way. Skipping is the honest answer: these probes did not run, so
     * they proved nothing, and the gate must not end in PASSED.
     */
    const storageReady = fn.length > 0 && bucket.length > 0;
    if (!storageReady) {
      console.log(
        '\n  The storage migration has not been applied. ' +
          'Apply openspec/changes/b6-transfer-deposit-and-review/storage-policy.sql ' +
          'as a Supabase migration, then re-run.\n' +
          '  The database probes below still run and still mean something.\n'
      );
    }

    // ============================================================== fixtures
    const owner = await prisma.owner.findFirst({
      where: { authUserId },
      select: { id: true },
    });
    if (!owner) {
      throw new Error(
        `No Owner row is linked to the signed-in auth user (${authUserId}). ` +
          'The key prefix would not match any policy — run provision-owner first.'
      );
    }

    const location = await prisma.location.create({
      data: { ownerId: owner.id, name: `${MARK} sucursal` },
      select: { id: true },
    });
    createdIds.location = location.id;

    const service = await prisma.service.create({
      data: { ownerId: owner.id, name: `${MARK} corte`, price: '10000.00', durationMinutes: 30 },
      select: { id: true },
    });
    createdIds.service = service.id;

    const barber = await prisma.barber.create({
      data: { locationId: location.id, displayName: `${MARK} barbero` },
      select: { id: true },
    });
    createdIds.barber = barber.id;

    const client = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${MARK} cliente`,
        email: `${MARK}@example.com`,
        phone: '+541100000000',
      },
      select: { id: true },
    });
    createdIds.client = client.id;

    /** A held booking, far enough out that the 45-minute extension does not clamp. */
    /**
     * Each gate booking gets its **own hour**, and that is not tidiness.
     *
     * The first run crashed here: every booking shared one start time on one
     * barber, so the second one the gate created overlapped a first that was
     * already `PENDING_APPROVAL` and blocking — and `attachReceipt` correctly
     * answered `slotLost`. The product was right and the fixture was wrong,
     * which is a good way for a gate to fail but a useless one to keep.
     */
    let bookingSlot = 0;

    async function makeBooking(
      token: string,
      overrides: Record<string, unknown> = {}
    ): Promise<{ id: string; startTime: Date; endTime: Date }> {
      bookingSlot += 1;
      const startTime = new Date(Date.now() + (48 + bookingSlot) * 60 * 60_000);
      return prisma.booking.create({
        data: {
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000),
          status: 'PENDING_PAYMENT',
          priceAtBooking: '10000.00',
          depositAmount: '2000.50',
          cancellationToken: `${MARK}-${token}`,
          holdExpiresAt: new Date(Date.now() + 15 * 60_000),
          ...overrides,
        },
        select: { id: true, startTime: true, endTime: true },
      });
    }

    const booking = await makeBooking('main');

    const payments = new PrismaPaymentRepository(prisma as never);
    const receipts = new PrismaTransferReceiptRepository(prisma as never);
    const bookings = new PrismaBookingRepository(prisma as never);

    // ================================================== 11.4 — the bytes alone
    //
    // Pure functions over real files. These need no infrastructure, so they run
    // whether or not the bucket exists.
    {
      const cases: [string, Buffer, string | null][] = [
        ['JPEG', JPEG_BYTES, 'image/jpeg'],
        ['PNG', PNG_BYTES, 'image/png'],
        ['PDF', PDF_BYTES, 'application/pdf'],
        ['SVG', SVG_BYTES, null],
      ];
      const wrong = cases.filter(
        ([, bytes, expected]) => detectReceiptType(new Uint8Array(bytes)) !== expected
      );
      report(
        '11.4a. Real files of each accepted type are classified by their leading bytes',
        wrong.length === 0,
        wrong.length === 0
          ? 'JPEG, PNG, PDF recognised; SVG refused'
          : `wrong: ${wrong.map((c) => c[0]).join(', ')}`
      );
    }

    {
      // The declared type is never consulted, in either direction. These are
      // the two files a real client actually sends wrong.
      const pdfNamedJpeg = detectReceiptType(new Uint8Array(PDF_BYTES));
      const jpegNamedPdf = detectReceiptType(new Uint8Array(JPEG_BYTES));
      report(
        '11.4b. A PDF declared as JPEG and a JPEG declared as PDF are both read as what they are',
        pdfNamedJpeg === 'application/pdf' && jpegNamedPdf === 'image/jpeg',
        `${pdfNamedJpeg} / ${jpegNamedPdf}`
      );
    }

    // =========================================== 11.1 / 11.2 / 11.3 / 11.5
    //
    // The heart of this gate. Everything else in the change has a unit test
    // that means something; the predicate does not, and cannot.
    //
    // **Every probe here is gated on the infrastructure existing.** A missing
    // bucket refuses every write, and each negative probe below asserts that a
    // write was refused — so without this guard they would all pass while
    // proving nothing, which is how the first run of this gate produced six
    // green lines against a bucket that did not exist.

    const legitimateKey = receiptObjectKey({
      ownerAuthUserId: authUserId,
      bookingId: booking.id,
      uploadedAt: new Date(),
      contentType: 'application/pdf',
    });

    if (!storageReady) {
      for (const probe of [
        '11.1a. An anonymous insert naming no booking is refused by the database',
        '11.1b. An anonymous insert for a booking that is not accepting one is refused',
        '11.1c. A legitimate anonymous insert is admitted',
        '11.2a. An anonymous insert under a foreign prefix is refused',
        '11.2b. The anonymous role cannot read a stored receipt',
        '11.2c. The anonymous role cannot enumerate the bucket',
        '11.2d. The anonymous role cannot delete a stored receipt',
        '11.2e. The owner can sign a read of their own object',
        '11.2f. The owner cannot sign a read outside their own prefix',
        '11.3. The bucket accepts a real JPG and a real PNG',
        '11.5a. The bucket refuses a type outside its allowlist',
        '11.5b. The bucket refuses a file past the ceiling',
      ]) {
        skip(probe, 'the bucket and its predicate are not deployed');
      }
    } else {
      {
        // A booking id that resolves to nothing. **This is the probe that
        // catches a column rename**: if the predicate stops resolving it starts
        // refusing everything, and only the positive probe below would notice —
        // so both run, and both have to hold.
        const key = `${authUserId}/does-not-exist-${Date.now()}/1.pdf`;
        const result = await anonymous.storage.from(BUCKET).upload(key, PDF_BYTES, {
          contentType: 'application/pdf',
        });
        if (!result.error) uploadedKeys.push(key);

        report(
          '11.1a. An anonymous insert naming no booking is refused by the database',
          refusedByPolicy(result.error),
          result.error?.message ?? 'ACCEPTED — the bucket is writable by anyone with the anon key'
        );
      }

      {
        // The right booking, the wrong owner prefix. This is the confinement
        // `auth.uid()` gives P1 for free and which B6 has to re-derive.
        const key = `00000000-0000-0000-0000-000000000000/${booking.id}/${Date.now()}.pdf`;
        const result = await anonymous.storage.from(BUCKET).upload(key, PDF_BYTES, {
          contentType: 'application/pdf',
        });
        if (!result.error) uploadedKeys.push(key);

        report(
          '11.2a. An anonymous insert under a foreign prefix is refused',
          refusedByPolicy(result.error),
          result.error?.message ?? 'ACCEPTED — the prefix is not being confined'
        );
      }

      {
        const cancelled = await makeBooking('cancelled', { status: 'CANCELLED' });
        const key = `${authUserId}/${cancelled.id}/${Date.now()}.pdf`;
        const result = await anonymous.storage.from(BUCKET).upload(key, PDF_BYTES, {
          contentType: 'application/pdf',
        });
        if (!result.error) uploadedKeys.push(key);

        report(
          '11.1b. An anonymous insert for a booking that is not accepting one is refused',
          refusedByPolicy(result.error),
          result.error?.message ?? 'ACCEPTED — a cancelled booking still admits uploads'
        );
      }

      {
        // The positive case. Without it, a predicate that refuses *everything*
        // would pass every probe above and the story would be dead on arrival.
        const result = await anonymous.storage.from(BUCKET).upload(legitimateKey, PDF_BYTES, {
          contentType: 'application/pdf',
        });
        if (!result.error) uploadedKeys.push(legitimateKey);

        report(
          '11.1c. A legitimate anonymous insert is admitted',
          result.error === null,
          result.error?.message ?? `stored at ${legitimateKey}`
        );
      }

      {
        const read = await anonymous.storage.from(BUCKET).download(legitimateKey);
        report(
          '11.2b. The anonymous role cannot read a stored receipt',
          refusedByPolicy(read.error),
          read.error?.message ?? 'READ — a bank document is readable by anyone with the anon key'
        );
      }

      {
        const listed = await anonymous.storage.from(BUCKET).list(authUserId);
        report(
          '11.2c. The anonymous role cannot enumerate the bucket',
          refusedByPolicy(listed.error) || (listed.data?.length ?? 0) === 0,
          listed.error?.message ?? `${listed.data?.length ?? 0} objects listed`
        );
      }

      {
        const removed = await anonymous.storage.from(BUCKET).remove([legitimateKey]);
        report(
          '11.2d. The anonymous role cannot delete a stored receipt',
          refusedByPolicy(removed.error) || (removed.data?.length ?? 0) === 0,
          removed.error?.message ?? `${removed.data?.length ?? 0} objects deleted`
        );
      }

      {
        // The owner's half: a signed URL, forced to download, and confined.
        const signed = await asOwner.storage
          .from(BUCKET)
          .createSignedUrl(legitimateKey, 300, { download: true });
        report(
          '11.2e. The owner can sign a read of their own object',
          signed.error === null && Boolean(signed.data?.signedUrl),
          signed.error?.message ?? 'signed'
        );

        const foreign = await asOwner.storage
          .from(BUCKET)
          .createSignedUrl('00000000-0000-0000-0000-000000000000/x/1.pdf', 300);
        report(
          '11.2f. The owner cannot sign a read outside their own prefix',
          foreign.error !== null,
          foreign.error?.message ?? 'SIGNED — the select policy is not confining reads'
        );
      }

      {
        // Each accepted type actually reaches the bucket. The MIME allowlist is
        // a third layer and it has to agree with the application's list.
        for (const [label, bytes, type] of [
          ['jpg', JPEG_BYTES, 'image/jpeg'],
          ['png', PNG_BYTES, 'image/png'],
        ] as const) {
          const key = `${authUserId}/${booking.id}/${Date.now()}-${label}.${label}`;
          const result = await anonymous.storage
            .from(BUCKET)
            .upload(key, bytes, { contentType: type });
          if (!result.error) uploadedKeys.push(key);
          report(
            `11.3. The bucket accepts a real ${label.toUpperCase()}`,
            result.error === null,
            result.error?.message ?? 'stored'
          );
        }
      }

      {
        const key = `${authUserId}/${booking.id}/${Date.now()}.svg`;
        const result = await anonymous.storage
          .from(BUCKET)
          .upload(key, SVG_BYTES, { contentType: 'image/svg+xml' });
        if (!result.error) uploadedKeys.push(key);
        report(
          '11.5a. The bucket refuses a type outside its allowlist',
          refusedByPolicy(result.error),
          result.error?.message ?? 'ACCEPTED — the MIME allowlist is not binding'
        );
      }

      {
        // The bucket's own ceiling, which is the layer under the route's two.
        const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_RECEIPT_BYTES)]);
        const key = `${authUserId}/${booking.id}/${Date.now()}-big.pdf`;
        const result = await anonymous.storage
          .from(BUCKET)
          .upload(key, oversized, { contentType: 'application/pdf' });
        if (!result.error) uploadedKeys.push(key);
        report(
          '11.5b. The bucket refuses a file past the ceiling',
          refusedByPolicy(result.error),
          result.error?.message ?? 'ACCEPTED — the size limit is not binding'
        );
      }
    }
    // ======================================== 11.6 — the hold extension
    {
      const before = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { holdExpiresAt: true },
      });

      const committed = await payments.commitBankTransfer({
        bookingId: booking.id,
        amount: '2000.50',
        startTime: booking.startTime,
        now: new Date(),
      });

      const after = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { holdExpiresAt: true },
      });

      const extendedBy =
        after?.holdExpiresAt && before?.holdExpiresAt
          ? Math.round((after.holdExpiresAt.getTime() - before.holdExpiresAt.getTime()) / 60_000)
          : null;

      report(
        '11.6a. Committing to transfer opens a BANK_TRANSFER payment and extends the hold',
        committed.outcome === 'committed' && extendedBy !== null && extendedBy > 0,
        `outcome=${committed.outcome} extended by ${extendedBy} minutes ` +
          `(expected about ${TRANSFER_HOLD_DURATION_MINUTES - 15})`
      );

      // The deadline is not pushed again on a repeat tap, or a client could
      // hold a slot for as long as they keep pressing the control.
      const again = await payments.commitBankTransfer({
        bookingId: booking.id,
        amount: '2000.50',
        startTime: booking.startTime,
        now: new Date(),
      });
      const third = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { holdExpiresAt: true },
      });
      report(
        '11.6b. A repeat commitment does not extend the hold again',
        again.outcome === 'alreadyCommitted' &&
          third?.holdExpiresAt?.getTime() === after?.holdExpiresAt?.getTime(),
        `outcome=${again.outcome}`
      );
    }

    {
      // The clamp, against a real row. `MIN_BOOKING_LEAD_MINUTES` is 60 today,
      // so this case is unreachable through the flow — and T53 records that the
      // lead time is the first constant a real shop will ask to lower.
      const soon = new Date(Date.now() + 20 * 60_000);
      const near = await prisma.booking.create({
        data: {
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          startTime: soon,
          endTime: new Date(soon.getTime() + 30 * 60_000),
          status: 'PENDING_PAYMENT',
          priceAtBooking: '10000.00',
          depositAmount: '2000.50',
          cancellationToken: `${MARK}-near`,
          holdExpiresAt: new Date(Date.now() + 10 * 60_000),
        },
        select: { id: true, startTime: true },
      });

      await payments.commitBankTransfer({
        bookingId: near.id,
        amount: '2000.50',
        startTime: near.startTime,
        now: new Date(),
      });

      const clamped = await prisma.booking.findUnique({
        where: { id: near.id },
        select: { holdExpiresAt: true },
      });

      report(
        '11.6c. The extended hold is clamped at startTime for a near-term appointment',
        clamped?.holdExpiresAt !== null &&
          clamped!.holdExpiresAt!.getTime() <= near.startTime.getTime(),
        `holdExpiresAt=${clamped?.holdExpiresAt?.toISOString()} startTime=${near.startTime.toISOString()}`
      );
    }

    // ============================ 11.7 — attaching, replacing, and the cap
    const livePayment = await payments.findLiveByBookingId(booking.id);
    if (!livePayment) throw new Error('Gate expected a live transfer payment on the main booking');

    {
      const attached = await receipts.attachReceipt({
        bookingId: booking.id,
        paymentId: livePayment.id,
        filePath: legitimateKey,
        barberId: barber.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        now: new Date(),
      });

      const moved = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      });

      report(
        '11.7a. A receipt attaches and moves the booking to PENDING_APPROVAL',
        attached.outcome === 'created' && moved?.status === 'PENDING_APPROVAL',
        `outcome=${attached.outcome} status=${moved?.status}`
      );
    }

    {
      // The revised rule: the superseded object stays. The anonymous uploader
      // holds no delete grant, and granting one would let anybody delete
      // anybody's receipt — so this is a bounded orphan, logged rather than
      // removed, and the probe asserts the row moved rather than the object.
      const replacementKey = `${authUserId}/${booking.id}/${Date.now()}-replacement.pdf`;
      const upload = await anonymous.storage
        .from(BUCKET)
        .upload(replacementKey, PDF_BYTES, { contentType: 'application/pdf' });
      if (!upload.error) uploadedKeys.push(replacementKey);

      const replaced = await receipts.attachReceipt({
        bookingId: booking.id,
        paymentId: livePayment.id,
        filePath: replacementKey,
        barberId: barber.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        now: new Date(),
      });

      const rows = await prisma.transferReceipt.count({
        where: { paymentId: livePayment.id },
      });

      report(
        '11.7b. A replacement updates the same row rather than inserting a second',
        replaced.outcome === 'replaced' && rows === 1,
        `outcome=${replaced.outcome} rows=${rows}`
      );

      if (!storageReady) {
        skip(
          '11.7c. The superseded object is left behind, as a bounded orphan',
          'nothing was uploaded, so there is no predecessor to look for'
        );
      } else {
        const predecessor = await asOwner.storage.from(BUCKET).createSignedUrl(legitimateKey, 60);
        report(
          '11.7c. The superseded object is left behind, as a bounded orphan',
          predecessor.error === null,
          predecessor.error
            ? `gone — the design says it should remain: ${predecessor.error.message}`
            : 'still present, and its key was logged for a future retention rule'
        );
      }
    }

    {
      // The cap. `uploadCount` is at 2 by now, so the third lands and the
      // fourth is refused.
      const third = await receipts.attachReceipt({
        bookingId: booking.id,
        paymentId: livePayment.id,
        filePath: `${authUserId}/${booking.id}/${Date.now()}-third.pdf`,
        barberId: barber.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        now: new Date(),
      });
      const fourth = await receipts.attachReceipt({
        bookingId: booking.id,
        paymentId: livePayment.id,
        filePath: `${authUserId}/${booking.id}/${Date.now()}-fourth.pdf`,
        barberId: barber.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        now: new Date(),
      });

      report(
        '11.7d. The per-booking submission cap refuses the fourth attempt',
        third.outcome === 'replaced' && fourth.outcome === 'capped',
        `third=${third.outcome} fourth=${fourth.outcome}`
      );
    }

    // ==================================== 11.8 — what PENDING_APPROVAL blocks
    {
      const held = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { startTime: true, endTime: true, status: true, holdExpiresAt: true },
      });

      report(
        '11.8a. A PENDING_APPROVAL booking whose appointment is ahead still blocks',
        held !== null &&
          blocksAvailability(
            {
              startTime: held.startTime,
              endTime: held.endTime,
              status: held.status,
              holdExpiresAt: held.holdExpiresAt,
            },
            new Date()
          ),
        `status=${held?.status} holdExpiresAt=${held?.holdExpiresAt?.toISOString() ?? 'null'}`
      );
    }

    {
      // The one exit this status has that does not depend on the owner being
      // attentive. The time is unsellable by then, so releasing it sells
      // nothing twice.
      const past = new Date(Date.now() - 3 * 60 * 60_000);
      const stale = await prisma.booking.create({
        data: {
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          startTime: past,
          endTime: new Date(past.getTime() + 30 * 60_000),
          status: 'PENDING_APPROVAL',
          priceAtBooking: '10000.00',
          depositAmount: '2000.50',
          cancellationToken: `${MARK}-stale`,
          holdExpiresAt: new Date(past.getTime() - 60 * 60_000),
        },
        select: { startTime: true, endTime: true, status: true, holdExpiresAt: true },
      });

      report(
        '11.8b. A PENDING_APPROVAL booking whose appointment has passed stops blocking',
        !blocksAvailability(
          {
            startTime: stale.startTime,
            endTime: stale.endTime,
            status: stale.status,
            holdExpiresAt: stale.holdExpiresAt,
          },
          new Date()
        ),
        'sweepable'
      );
    }

    // ============================================ 11.9 — the owner's decisions
    // An async block rather than a bare one: the early returns below must leave
    // these probes and nothing else, so a fixture that comes out wrong costs one
    // section instead of every section after it.
    await (async () => {
      const rejectBooking = await makeBooking('reject');
      const rejectPayment = await payments.commitBankTransfer({
        bookingId: rejectBooking.id,
        amount: '2000.50',
        startTime: rejectBooking.startTime,
        now: new Date(),
      });
      /**
       * A fixture that did not come out as expected is **reported, never
       * thrown**.
       *
       * The first run threw here, and the throw cost more than the fault did:
       * one bad fixture aborted the script, so the approval probes, the
       * scope-miss probe and the timing observation never ran at all — and the
       * output gave no hint that they had been skipped rather than passed.
       */
      if (rejectPayment.outcome !== 'committed') {
        report(
          '11.9. Rejection probes could not be set up',
          false,
          `commitBankTransfer answered ${rejectPayment.outcome}`
        );
        return;
      }

      const key = `${authUserId}/${rejectBooking.id}/${Date.now()}.pdf`;
      if (storageReady) {
        const upload = await anonymous.storage
          .from(BUCKET)
          .upload(key, PDF_BYTES, { contentType: 'application/pdf' });
        if (!upload.error) uploadedKeys.push(key);
      }

      const attached = await receipts.attachReceipt({
        bookingId: rejectBooking.id,
        paymentId: rejectPayment.payment.id,
        filePath: key,
        barberId: barber.id,
        startTime: rejectBooking.startTime,
        endTime: rejectBooking.endTime,
        now: new Date(),
      });
      if (attached.outcome !== 'created') {
        report(
          '11.9. Rejection probes could not be set up',
          false,
          `attachReceipt answered ${attached.outcome}`
        );
        return;
      }

      const rejected = await receipts.reject({
        receiptId: attached.receiptId,
        ownerId: owner.id,
        now: new Date(),
      });

      const afterReject = await prisma.booking.findUnique({
        where: { id: rejectBooking.id },
        select: { status: true, holdExpiresAt: true },
      });
      const rejectedPaymentRow = await prisma.payment.findUnique({
        where: { id: rejectPayment.payment.id },
        select: { status: true },
      });

      report(
        '11.9a. Rejecting cancels the booking, rejects the payment and releases the slot',
        rejected.outcome === 'applied' &&
          afterReject?.status === 'CANCELLED' &&
          rejectedPaymentRow?.status === 'REJECTED',
        `booking=${afterReject?.status} payment=${rejectedPaymentRow?.status}`
      );

      // A second rejection matches zero rows. Ordinary, not an error.
      const again = await receipts.reject({
        receiptId: attached.receiptId,
        ownerId: owner.id,
        now: new Date(),
      });
      report(
        '11.9b. A second rejection changes nothing and is not an error',
        again.outcome === 'notPending',
        `outcome=${again.outcome}`
      );
    })();

    {
      // Approval takes the advisory lock. B4 shipped one that had never worked,
      // past a test that mocked the call — this statement is the only thing
      // that can tell us it runs.
      const receipt = await prisma.transferReceipt.findFirst({
        where: { payment: { bookingId: booking.id } },
        select: { id: true },
      });
      if (!receipt) throw new Error('Gate expected a receipt on the main booking');

      const approved = await receipts.approve({
        receiptId: receipt.id,
        ownerId: owner.id,
        now: new Date(),
      });

      const afterApprove = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { status: true, holdExpiresAt: true },
      });
      const approvedPaymentRow = await prisma.payment.findUnique({
        where: { id: livePayment.id },
        select: { status: true, approvedAt: true },
      });

      report(
        '11.9c. Approving confirms the booking and approves the payment, under the lock',
        approved.outcome === 'applied' &&
          afterApprove?.status === 'CONFIRMED' &&
          approvedPaymentRow?.status === 'APPROVED',
        `booking=${afterApprove?.status} payment=${approvedPaymentRow?.status} ` +
          `approvedAt=${approvedPaymentRow?.approvedAt?.toISOString() ?? 'null'}`
      );

      report(
        '11.9d. A confirmed booking carries no hold deadline',
        afterApprove?.holdExpiresAt === null,
        `holdExpiresAt=${afterApprove?.holdExpiresAt?.toISOString() ?? 'null'}`
      );
    }

    {
      // A receipt outside the caller's scope is indistinguishable from one that
      // never existed. Both answer `notFound`.
      const foreign = await receipts.approve({
        receiptId: 'rcp-does-not-exist',
        ownerId: owner.id,
        now: new Date(),
      });
      report(
        '11.9e. A receipt that does not resolve within the owner scope answers notFound',
        foreign.outcome === 'notFound',
        `outcome=${foreign.outcome}`
      );
    }

    // ===================================================== 11.11 — the cost
    {
      const token = `${MARK}-reject`;
      const started = Date.now();
      await bookings.findByCancellationToken(token);
      const elapsed = Date.now() - started;

      observe(
        '11.11. The confirmation page read, end to end',
        `${elapsed} ms for the composed booking read plus the parallel Mercado Pago presence ` +
          'statement. **Representative, not inflated** — an earlier version of this note claimed ' +
          'the figure was an upper bound because this script sets `maxUses: 1`, and that was ' +
          'wrong: `createPrismaClient` sets it too, because workerd cannot reuse a socket across ' +
          'request contexts. Every request the application serves pays connection setup per ' +
          'query, so this number is the same shape as the page. What it still excludes is the ' +
          'Next render on top, which the preview measurement (11.10) includes.'
      );
    }
  } finally {
    // ------------------------------------------------------------- cleanup
    //
    // Objects first: the bucket is not covered by any foreign key, so nothing
    // else removes them. The owner's session is what can, which is the same
    // asymmetry the design describes.
    if (uploadedKeys.length > 0) {
      const removed = await asOwner.storage.from(BUCKET).remove(uploadedKeys);
      report(
        '11.z1. The gate removed every object it stored',
        removed.error === null && (removed.data?.length ?? 0) === uploadedKeys.length,
        removed.error?.message ?? `${removed.data?.length ?? 0} of ${uploadedKeys.length} removed`
      );
    }

    // Foreign-key order. Every booking FK is Restrict, so nothing cascades.
    await prisma.transferReceipt.deleteMany({
      where: { payment: { booking: { cancellationToken: { startsWith: MARK } } } },
    });
    await prisma.payment.deleteMany({
      where: { booking: { cancellationToken: { startsWith: MARK } } },
    });
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    if (createdIds.client) await prisma.client.delete({ where: { id: createdIds.client } });
    if (createdIds.barber) await prisma.barber.delete({ where: { id: createdIds.barber } });
    if (createdIds.service) await prisma.service.delete({ where: { id: createdIds.service } });
    if (createdIds.location) await prisma.location.delete({ where: { id: createdIds.location } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report(
      '11.z2. The gate cleaned up after itself',
      leftover === 0,
      `${leftover} rows left behind`
    );

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
