import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review B1 established and B2 inherited, applied to the
 * one root in this project that **does** wire a payment repository.
 *
 * B4 is the narrowing, not the relaxation: the guarantee moved from an absent
 * dependency to a projection that cannot express the leak. So the list of what
 * must stay absent is shorter here than on the read route, and what replaced
 * the missing item is asserted rather than assumed.
 */
function importLinesOf(file: string): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
}

describe('bookingCreationService - what must stay absent', () => {
  it('should_import_no_supabase_client_and_no_credential_cipher', () => {
    // PC3's rule: a surface with no need for a cipher must not construct one.
    // The payment repository is built without it, so `findMercadoPagoAccessToken`
    // would throw rather than quietly return a plaintext token.
    //
    // Asserted over import lines rather than file text, because the file names
    // both in prose to explain why they are absent — a text scan would fail on
    // the comments that document the decision.
    const imports = importLinesOf('./bookingCreationService.ts');

    expect(imports).not.toMatch(/supabase|createClient/i);
    expect(imports).not.toMatch(/Cipher/i);
    // Not empty for a trivial reason.
    expect(imports).toMatch(/BookingCreationService/);
  });

  it('should_wire_the_payment_repository_without_a_cipher_argument', () => {
    // The one dependency B1, B2 and B3 all refused. It is here because the
    // payment gate is a question about that row — and it is constructed with
    // no second argument, which is what keeps the token unreadable.
    const source = readFileSync(new URL('./bookingCreationService.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db\)/);
    expect(source).not.toMatch(/new PrismaPaymentConfigRepository\(db,/);
  });

  it('should_assert_no_timezone_at_module_scope', () => {
    // B3 settled this shape for the read side: a composition root that throws
    // at import time takes down a route for a request that never needed a
    // timezone. The assertion lives inside the service, before any repository
    // work.
    const source = readFileSync(new URL('./bookingCreationService.ts', import.meta.url), 'utf8');
    const executable = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    expect(executable).not.toMatch(/hasTimezoneSupport\(\)/);
  });
});

describe('the booking route - what must stay absent', () => {
  it('should_import_no_supabase_client_and_no_credential_cipher', () => {
    const imports = importLinesOf('./route.ts');

    expect(imports).not.toMatch(/supabase|createClient/i);
    expect(imports).not.toMatch(/Cipher/i);
  });

  it('should_reach_the_database_only_through_its_composition_root', () => {
    // A handler that builds its own repositories is a handler that can build
    // one the composer deliberately withheld.
    const imports = importLinesOf('./route.ts');

    expect(imports).not.toMatch(/infrastructure\/prisma\/Prisma/);
    expect(imports).toMatch(/bookingCreationService/);
  });
});
