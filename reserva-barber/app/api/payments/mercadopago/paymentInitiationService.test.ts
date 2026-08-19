import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The composition-root review, applied to the public flow's payment roots — the
 * ones that **do** construct a cipher.
 *
 * B4 added this shape of test after its runtime found a repository wired into
 * one composer and not the other — a defect invisible to 2061 passing tests,
 * because the page tests mocked the composer wholesale and the service tests
 * constructed it directly. Neither ever ran the real composer. So the composer
 * is reviewed as text, which is the only thing that reaches it.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function importLinesOf(file: string): string {
  return sourceOf(file)
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
}

describe('paymentInitiationService - every dependency is wired', () => {
  /**
   * Six arguments, each asserted by name. T57 in one test: a missing argument
   * on this path would compile, typecheck and pass every service unit test,
   * and would surface as a client unable to pay at a shop that is correctly
   * configured — which is exactly the defect B4 shipped and caught by hand.
   */
  it('should_pass_all_six_collaborators', () => {
    const source = sourceOf('./paymentInitiationService.ts');

    expect(source).toMatch(/new PrismaBookingRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db, new WebCryptoCipher\(\)\)/);
    expect(source).toMatch(/new MercadoPagoGateway\(\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
  });

  /**
   * The payment config repository's cipher is optional in its constructor, for
   * PC1's sake. Optional is exactly what T57 warns about, so on this path the
   * argument is asserted present rather than trusted — the bare-`db` form is
   * what the booking write uses, and using it here would make every payment
   * fail to decrypt while everything still compiled.
   */
  it('should_never_build_the_payment_repository_without_its_cipher', () => {
    const source = sourceOf('./paymentInitiationService.ts');

    expect(source).not.toMatch(/new PrismaPaymentConfigRepository\(db\)/);
  });
});

describe('the cipher stays confined to a known set of roots', () => {
  /**
   * **The complete set, enumerated from the repository rather than spot-checked.**
   *
   * The guarantee B1–B4 held by absence is now held by confinement, and
   * confinement is only worth anything if it is enumerable. Checking two files
   * by hand would pass while a third constructor appeared somewhere neither was
   * looking — which is precisely how a guarantee decays into a comment.
   *
   * Three entries, and each earns its place: the dashboard's credential editor
   * (PC2, which writes the token), and B5's two public roots, which must
   * decrypt it to charge and to authenticate a notification. Adding a fourth is
   * a deliberate act, and this test is where it has to be argued for.
   */
  it('should_be_constructed_in_exactly_the_three_expected_roots', () => {
    const root = new URL('../../../../', import.meta.url);

    // A plain recursive walk rather than a glob helper: this repository's
    // `@types/node` does not declare `fs.globSync`, and a test that reaches for
    // an untyped API to prove a security property is the wrong trade.
    function walk(dir: string): string[] {
      return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) return walk(`${path}/`);
        return path.endsWith('.ts') ? [path] : [];
      });
    }

    const constructors = [...walk('app/'), ...walk('src/')]
      // Tests and the runtime probe construct one to exercise it, which is not
      // a production surface that can decrypt a stored credential.
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.probe.ts'))
      .filter((file) =>
        readFileSync(new URL(file, root), 'utf8').includes('new WebCryptoCipher()')
      )
      .sort();

    expect(constructors).toEqual([
      'app/(dashboard)/mercado-pago/paymentConfigService.ts',
      'app/api/payments/mercadopago/paymentInitiationService.ts',
      'app/api/webhooks/mercadopago/webhookService.ts',
    ]);
  });

  it('should_keep_the_read_side_of_the_public_flow_cipherless', () => {
    // The two public-flow composers that must never gain one: the booking write
    // and the confirmation page. Both mention the cipher only in prose, which
    // is why this asserts on construction rather than on the name appearing.
    const bookingWrite = sourceOf('../../bookings/bookingCreationService.ts');
    const confirmation = sourceOf(
      '../../../b/[slug]/reserva/[token]/bookingConfirmationService.ts'
    );

    expect(bookingWrite).not.toMatch(/new WebCryptoCipher\(\)/);
    expect(confirmation).not.toMatch(/new WebCryptoCipher\(\)/);
  });

  it('should_leave_the_booking_write_composer_cipherless', () => {
    // Restating B4's own assertion from this side, so that a change made here
    // cannot quietly relax it there.
    const source = sourceOf('../../bookings/bookingCreationService.ts');

    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db\)/);
    expect(source).not.toMatch(/new PrismaPaymentConfigRepository\(db,/);
  });

  it('should_keep_the_public_readiness_type_unable_to_hold_a_token', () => {
    // A type with no field the token fits into cannot leak it through a
    // serialized prop, a logged object or an error payload — a stronger
    // guarantee than every consumer remembering to strip it.
    const model = readFileSync(
      new URL('../../../../src/server/domain/models/PaymentConfig.ts', import.meta.url),
      'utf8'
    );
    const readiness = model.slice(
      model.indexOf('export type PublicPaymentReadiness'),
      model.indexOf('};', model.indexOf('export type PublicPaymentReadiness'))
    );

    expect(readiness).toMatch(/hasMercadoPagoCredentials: boolean/);
    expect(readiness).not.toMatch(/accessToken/i);
    expect(readiness).not.toMatch(/mpAccessToken/);
  });
});

describe('the payment route - what must stay absent', () => {
  it('should_reach_the_database_only_through_its_composition_root', () => {
    // A handler that builds its own repositories is a handler that can build
    // one with a cipher the composer deliberately shaped.
    const imports = importLinesOf('./route.ts');

    expect(imports).not.toMatch(/infrastructure\/prisma\/Prisma/);
    expect(imports).toMatch(/paymentInitiationService/);
  });

  it('should_construct_no_cipher_of_its_own', () => {
    const imports = importLinesOf('./route.ts');

    expect(imports).not.toMatch(/Cipher/i);
  });

  it('should_import_no_supabase_client', () => {
    // Nothing in this flow uploads, and nothing in it has a session to resolve.
    const imports = importLinesOf('./route.ts');

    expect(imports).not.toMatch(/supabase|createClient/i);
  });
});
