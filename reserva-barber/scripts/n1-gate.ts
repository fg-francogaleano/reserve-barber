// GATE N1 — the confirmation email against the live database.
//
// **This change already shipped one defect that every mock certified.** The
// confirmation projection selected `BusinessProfile.name`, a column that does
// not exist — the field is `businessName` — and fifteen repository tests passed
// against a query the database would have refused. `tsc` caught that one. What
// `tsc` cannot catch is the rest of the same class:
//
//   1. **The join path itself.** `Booking → Client` and
//      `Booking → Barber → Location → Owner → BusinessProfile` is four hops to
//      reach a shop's name and slug. A mock returns whatever shape the test
//      author imagined; only the database confirms the relations resolve and
//      that a shop with no profile really does yield null.
//
//   2. **Money off the real driver.** PC3 measured a stored `2000.50` coming
//      back as `2000.5`, after which integer-cent arithmetic read the lone `5`
//      as five centavos. The email renders both the deposit and the balance,
//      and **an email cannot be corrected after it is sent** — this is the one
//      surface in the product where that defect would be permanent.
//
//   3. **`Intl` on the runtime that renders the message.** The M3 gate proved
//      full ICU is present on `workerd`; the email builder is a new caller of
//      it, and a message dated in the wrong timezone is a client at the shop on
//      the wrong day.
//
//   4. **The bookkeeping write.** `markConfirmationEmailSent` is specified not
//      to disturb the booking. A unit test asserts the `data` argument; only
//      the database can say what the row looks like afterwards — and on the
//      first run it said something the contract had got wrong. Prisma's
//      `@updatedAt` bumps on every write through the client, so the original
//      promise of "one column and nothing else" was false as written. Probe 6.2
//      asserts the property that actually matters instead.
//
// Everything it creates is prefixed `__n1_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
// It needs no owner sign-in and sends no mail: the provider is a stub, because
// what is under test here is the chain that composes a message, not the
// provider that delivers it. Delivery is proven by a real inbox and by nothing
// else.
//
//   npx tsx scripts/n1-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBookingRepository } from '../src/server/infrastructure/prisma/PrismaBookingRepository';
import { BookingConfirmationNotificationService } from '../src/server/application/services/BookingConfirmationNotificationService';
import { buildBookingConfirmationEmail } from '../src/server/domain/models/bookingConfirmationEmail';
import { systemClock } from '../src/server/domain/repositories/IClock';
import { createEmailSender } from '../src/server/infrastructure/email/emailSenderFactory';
import type {
  EmailMessage,
  EmailSendOutcome,
  IEmailSender,
} from '../src/server/domain/repositories/IEmailSender';

const MARK = '__n1_gate__';
const ORIGIN = 'https://gate.example.com';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let failures = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

/** An open question. Reported, never counted as a failure. */
function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

function recordingLogger() {
  const errors: { message: string; context?: Record<string, unknown> }[] = [];
  const infos: { message: string; context?: Record<string, unknown> }[] = [];
  return {
    errors,
    infos,
    logger: {
      debug: () => {},
      info: (message: string, context?: Record<string, unknown>) =>
        infos.push({ message, context }),
      warn: () => {},
      error: (message: string, context?: Record<string, unknown>) =>
        errors.push({ message, context }),
    },
  };
}

/** A provider that reports whatever this gate needs and delivers nothing. */
function stubSender(outcome: EmailSendOutcome) {
  const sent: EmailMessage[] = [];
  const sender: IEmailSender = {
    async send(message) {
      sent.push(message);
      return { outcome };
    },
  };
  return { sent, sender };
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const ownerIds: string[] = [];

  try {
    console.log('\nGATE N1 — the booking confirmation email\n');

    // ============================================================== fixtures
    //
    // Two owners: one with a BusinessProfile and one deliberately without.
    // The second is not decoration — a shop with no profile has no slug, so
    // there is no address the link could be built on, and the projection is
    // specified to answer null rather than compose a broken URL.
    async function makeOwner(suffix: string, withProfile: boolean) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@example.com` },
        select: { id: true },
      });
      ownerIds.push(owner.id);

      if (withProfile) {
        await prisma.businessProfile.create({
          data: {
            ownerId: owner.id,
            businessName: `Barbería ${MARK} ${suffix}`,
            publicSlug: `${MARK}-${suffix}`,
          },
        });
      }

      const location = await prisma.location.create({
        data: {
          ownerId: owner.id,
          name: `Sucursal ${MARK} ${suffix}`,
          address: suffix === 'a' ? 'Gorriti 4500' : null,
        },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `Barbero ${MARK} ${suffix}` },
        select: { id: true },
      });
      const service = await prisma.service.create({
        data: {
          ownerId: owner.id,
          name: `Corte ${MARK} ${suffix}`,
          price: '9000.00',
          durationMinutes: 30,
        },
        select: { id: true },
      });
      const client = await prisma.client.create({
        data: {
          ownerId: owner.id,
          name: `Cliente ${MARK} ${suffix}`,
          email: `${MARK}-${suffix}-client@example.com`,
          // Present in the row, and it must never reach the message.
          phone: '+5491133334444',
        },
        select: { id: true },
      });

      return { owner, location, barber, service, client };
    }

    const withProfile = await makeOwner('a', true);
    const noProfile = await makeOwner('b', false);

    let slot = 0;

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      deposit: string
    ): Promise<string> {
      slot += 1;
      // 15:30 business-local on a fixed future date, so the rendered time is a
      // constant this gate can assert rather than a moving target.
      const startTime = new Date('2026-08-30T18:30:00.000Z');
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime: new Date(startTime.getTime() + slot * 60 * 60_000),
          endTime: new Date(startTime.getTime() + slot * 60 * 60_000 + 30 * 60_000),
          status: 'CONFIRMED',
          priceAtBooking: '9000.00',
          depositAmount: deposit,
          cancellationToken: `${MARK}-${token}`,
        },
        select: { id: true },
      });
      return booking.id;
    }

    // The deposit that PC3 measured: stored with a real scale of 2, returned by
    // the driver as `2000.5`.
    const main = await makeBooking(withProfile, 'main', '2000.50');
    const orphan = await makeBooking(noProfile, 'orphan', '2000.50');

    const repository = new PrismaBookingRepository(prisma as never);

    // ======================================================== 1. the projection
    const projection = await repository.findForConfirmationEmail(main);

    report(
      '1.1. The four-hop join resolves against the real schema',
      projection !== null,
      projection === null ? 'projection returned null' : 'projection returned a row'
    );

    if (projection === null) throw new Error('cannot continue without a projection');

    report(
      '1.2. It carries the shop name and slug from BusinessProfile',
      projection.shopName.includes(MARK) && projection.shopSlug.includes(MARK),
      `shopName=${projection.shopName} slug=${projection.shopSlug}`
    );

    report(
      '1.3. It carries the client name and email, which is the point',
      projection.clientEmail === `${MARK}-a-client@example.com`,
      `clientEmail=${projection.clientEmail}`
    );

    report(
      '1.4. It carries no phone field at all',
      !Object.keys(projection).includes('clientPhone') &&
        !JSON.stringify(projection).includes('1133334444'),
      `keys=${Object.keys(projection).join(',')}`
    );

    report(
      '1.5. The branch, barber and service resolve',
      projection.locationName.includes(MARK) &&
        projection.barberName.includes(MARK) &&
        projection.serviceName.includes(MARK) &&
        projection.locationAddress === 'Gorriti 4500',
      `location=${projection.locationName} address=${projection.locationAddress}`
    );

    report(
      '1.6. A shop with no BusinessProfile answers null rather than a broken link',
      (await repository.findForConfirmationEmail(orphan)) === null,
      'orphan booking'
    );

    report(
      '1.7. A booking that does not exist answers null',
      (await repository.findForConfirmationEmail(`${MARK}-absent`)) === null,
      'absent id'
    );

    // ============================================ 2. money off the real driver
    report(
      '2.1. The deposit crosses as a canonical string, scale intact',
      projection.depositAmount === '2000.50',
      `depositAmount=${JSON.stringify(projection.depositAmount)}`
    );

    report(
      '2.2. The price crosses as a canonical string',
      projection.priceAtBooking === '9000.00',
      `priceAtBooking=${JSON.stringify(projection.priceAtBooking)}`
    );

    // ================================ 3. the message, rendered on this runtime
    const message = buildBookingConfirmationEmail({ booking: projection, origin: ORIGIN });

    report(
      '3.1. The deposit renders as es-AR currency, not as centavos',
      message.text.includes('2.000,50') && !message.text.includes('2.000,05'),
      message.text.split('\n').find((l) => l.startsWith('Seña')) ?? '<no deposit line>'
    );

    report(
      '3.2. The balance is price less deposit, in integer cents',
      message.text.includes('6.999,50'),
      message.text.split('\n').find((l) => l.startsWith('A pagar')) ?? '<no balance line>'
    );

    report(
      '3.3. The appointment renders business-local, never UTC',
      message.text.includes('16:30') && !message.text.includes('19:30'),
      message.text.split('\n').find((l) => l.startsWith('Cuándo')) ?? '<no when line>'
    );

    report(
      '3.4. The link is composed from origin, slug and token',
      message.text.includes(`${ORIGIN}/b/${MARK}-a/reserva/${MARK}-main`),
      'link present in the text part'
    );

    report(
      '3.5. The phone reaches neither part of the message',
      !message.text.includes('1133334444') && !message.html.includes('1133334444'),
      'no phone in text or html'
    );

    report(
      '3.6. It is addressed to the client and to nobody else',
      message.to === projection.clientEmail,
      `to=${message.to}`
    );

    // ==================================== 4. the origin degradation, for real
    const linkless = buildBookingConfirmationEmail({ booking: projection, origin: null });

    report(
      '4.1. No origin removes the link and the token entirely',
      !linkless.text.includes(`${MARK}-main`) && !linkless.html.includes(`${MARK}-main`),
      'no token anywhere in either part'
    );

    report(
      '4.2. The appointment is still confirmed without a link',
      linkless.text.includes('16:30') && linkless.subject.length > 0,
      'message still carries the appointment'
    );

    // ============================= 5. the service, non-fatal without a provider
    const rejected = recordingLogger();
    const rejectedSender = stubSender('rejected');
    await new BookingConfirmationNotificationService(
      repository,
      rejectedSender.sender,
      systemClock,
      rejected.logger,
      ORIGIN
    ).notifyConfirmed(main);

    const afterRejected = await prisma.booking.findUnique({
      where: { id: main },
      select: { status: true, confirmationEmailSentAt: true },
    });

    report(
      '5.1. A refused send leaves the booking confirmed',
      afterRejected?.status === 'CONFIRMED',
      `status=${afterRejected?.status}`
    );

    report(
      '5.2. A refused send records no instant',
      afterRejected?.confirmationEmailSentAt === null,
      `sentAt=${afterRejected?.confirmationEmailSentAt}`
    );

    report(
      '5.3. It is logged with the outcome and no personal data',
      rejected.errors.some((e) => e.context?.outcome === 'rejected') &&
        !JSON.stringify(rejected.errors).includes('client@example.com') &&
        !JSON.stringify(rejected.errors).includes(`${MARK}-main`),
      `errors=${rejected.errors.length}`
    );

    // ============================ 6. the bookkeeping write touches one column
    const before = await prisma.booking.findUnique({ where: { id: main } });

    const sentRun = recordingLogger();
    const sentSender = stubSender('sent');
    await new BookingConfirmationNotificationService(
      repository,
      sentSender.sender,
      systemClock,
      sentRun.logger,
      ORIGIN
    ).notifyConfirmed(main);

    const after = await prisma.booking.findUnique({ where: { id: main } });

    report(
      '6.1. A successful send records the instant',
      after?.confirmationEmailSentAt !== null,
      `sentAt=${after?.confirmationEmailSentAt?.toISOString()}`
    );

    const changed = Object.keys(before ?? {}).filter((key) => {
      const a = (before as Record<string, unknown>)[key];
      const b = (after as Record<string, unknown>)[key];
      return JSON.stringify(a) !== JSON.stringify(b);
    });

    /**
     * **`updatedAt` moves too, and this gate is what found that out.**
     *
     * The contract originally promised "one column and nothing else". Prisma's
     * `@updatedAt` bumps on every write through the client, so the promise was
     * false the moment it was written — and no unit test could see it, because
     * they assert the `data` argument rather than the row.
     *
     * Making it literally true would mean `$executeRaw`, which would make this
     * the only write in the product that bypasses the client, for a cosmetic
     * property. The claim was corrected instead. What actually matters is that
     * nothing describing *what the booking is* moved, and that is what this
     * probe asserts.
     */
    const FORBIDDEN = [
      'status',
      'holdExpiresAt',
      'cancelledAt',
      'cancelledBy',
      'priceAtBooking',
      'depositAmount',
      'startTime',
      'endTime',
      'cancellationToken',
      'clientId',
      'barberId',
      'serviceId',
    ];
    const forbiddenMoved = changed.filter((key) => FORBIDDEN.includes(key));

    report(
      '6.2. Nothing describing what the booking is was touched',
      forbiddenMoved.length === 0 && changed.includes('confirmationEmailSentAt'),
      `changed=[${changed.join(', ')}] forbidden=[${forbiddenMoved.join(', ')}]`
    );

    report(
      '6.3. Only the send instant and Prisma own updatedAt moved',
      changed.every((key) => key === 'confirmationEmailSentAt' || key === 'updatedAt'),
      `changed=[${changed.join(', ')}]`
    );

    report(
      '6.4. The message the service composed carries the link',
      sentSender.sent.length === 1 &&
        (sentSender.sent[0]?.text.includes(`${ORIGIN}/b/${MARK}-a/reserva/`) ?? false),
      `messages=${sentSender.sent.length}`
    );

    // ==================== 7. the origin degradation through the service itself
    const originless = recordingLogger();
    const originlessSender = stubSender('sent');
    await new BookingConfirmationNotificationService(
      repository,
      originlessSender.sender,
      systemClock,
      originless.logger,
      null
    ).notifyConfirmed(main);

    report(
      '7.1. An unset origin still sends, and says why the link is missing',
      originlessSender.sent.length === 1 &&
        originless.errors.some((e) => e.context?.reason === 'originMissing'),
      `reasons=${originless.errors.map((e) => e.context?.reason).join(',')}`
    );

    report(
      '7.2. The sent message carries no link and no token',
      !(originlessSender.sent[0]?.text.includes(`${MARK}-main`) ?? true),
      'token absent from the composed message'
    );

    const loopback = recordingLogger();
    const loopbackSender = stubSender('sent');
    await new BookingConfirmationNotificationService(
      repository,
      loopbackSender.sender,
      systemClock,
      loopback.logger,
      'http://localhost:8787'
    ).notifyConfirmed(main);

    report(
      '7.3. A loopback origin is refused, not emitted into an inbox',
      !(loopbackSender.sent[0]?.text.includes('localhost') ?? true) &&
        loopback.errors.some((e) => e.context?.reason === 'originMissing'),
      'localhost never reaches the message'
    );

    // ===================================== 8. a booking that vanished mid-flight
    const missing = recordingLogger();
    const missingSender = stubSender('sent');
    await new BookingConfirmationNotificationService(
      repository,
      missingSender.sender,
      systemClock,
      missing.logger,
      ORIGIN
    ).notifyConfirmed(`${MARK}-absent`);

    report(
      '8.1. A missing booking sends nothing and reports itself',
      missingSender.sent.length === 0 &&
        missing.errors.some((e) => e.context?.reason === 'projectionEmpty'),
      'reported as projectionEmpty, the only cause it can distinguish'
    );

    // ================ 9. the unconfigured sender, through the real factory
    //
    // The adversarial pass found this logging on construction, which put one
    // `error` line on every request to a public unauthenticated endpoint. The
    // property is now "one line per attempted send", and it is asserted here
    // against the real factory rather than only against a unit double, because
    // the composition roots build it per request.
    const savedKey = process.env.RESEND_API_KEY;
    const savedFrom = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;

    const unconfigured = recordingLogger();
    createEmailSender(unconfigured.logger);
    createEmailSender(unconfigured.logger);
    createEmailSender(unconfigured.logger);

    report(
      '9.1. Building the sender with no configuration logs nothing',
      unconfigured.errors.length === 0,
      `${unconfigured.errors.length} entries after three constructions`
    );

    await new BookingConfirmationNotificationService(
      repository,
      createEmailSender(unconfigured.logger),
      systemClock,
      unconfigured.logger,
      ORIGIN
    ).notifyConfirmed(main);

    const configEntries = unconfigured.errors.filter((e) => e.context?.reason === 'notConfigured');

    report(
      '9.2. One attempted send reports the missing variables exactly once',
      configEntries.length === 1 &&
        String(configEntries[0]?.context?.missing).includes('RESEND_API_KEY') &&
        String(configEntries[0]?.context?.missing).includes('EMAIL_FROM'),
      `missing=${configEntries[0]?.context?.missing ?? '<none>'}`
    );

    report(
      '9.3. Neither the recipient nor the message reaches that entry',
      !JSON.stringify(unconfigured.errors).includes('client@example.com') &&
        !JSON.stringify(unconfigured.errors).includes(`${MARK}-main`),
      'no recipient and no token in the configuration entries'
    );

    if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
    if (savedFrom !== undefined) process.env.EMAIL_FROM = savedFrom;

    observe(
      '9.4. Delivery',
      'NOT under test here. A provider acceptance is not delivery, and this gate ' +
        'uses a stub. Only a message arriving in a real inbox proves N1 works.'
    );
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades.
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    await prisma.client.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.barber.deleteMany({ where: { location: { ownerId: { in: ownerIds } } } });
    await prisma.service.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.location.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.businessProfile.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.owner.deleteMany({ where: { id: { in: ownerIds } } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('10.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
