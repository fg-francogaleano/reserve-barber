import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, applied to the one root in the public flow that
 * **does** construct a cipher.
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

describe('the cipher stays confined to this one root', () => {
  it('should_be_the_only_public_flow_composer_that_builds_one', () => {
    // The guarantee B1-B4 held by absence, now held by confinement. If a second
    // public-flow composer ever constructs a cipher, this is where it shows.
    const bookingWrite = sourceOf('../../bookings/bookingCreationService.ts');
    const confirmation = sourceOf(
      '../../../b/[slug]/reserva/[token]/bookingConfirmationService.ts'
    );

    expect(bookingWrite).not.toMatch(/WebCryptoCipher/);
    expect(confirmation).not.toMatch(/WebCryptoCipher/);
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
