import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, for D5's root.
 *
 * The precedent and the reason are C2's, D3's and D4's: page tests mock the
 * composer wholesale and service tests construct it directly, so nothing in the
 * suite ever runs the real composer. It is reviewed as text, which is the only
 * thing that reaches it.
 *
 * What it protects here is the proposal's own claim — that D5 adds no
 * dependency, no provider and no external call — and the count of surfaces
 * permitted to decrypt a stored Mercado Pago credential, which B5 established
 * and every story since has had to leave alone.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const ROOT = './statisticsService.ts';

describe('statisticsService - what it wires', () => {
  it('should_pass_its_three_collaborators', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(/new StatisticsService\(/);
    expect(source).toMatch(/new PrismaStatisticsRepository\(getPrismaClient\(\)\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/\blogger\b/);
  });

  it('should_construct_the_repository_once', () => {
    expect(sourceOf(ROOT).match(/new PrismaStatisticsRepository\(/g)).toHaveLength(1);
  });

  /**
   * The clock is not incidental. Every period this page reports on is a
   * business-local calendar boundary, so a root that read the runtime's clock
   * directly would make the timezone behaviour untestable — which is the
   * failure `businessTime.ts` exists to prevent.
   */
  it('should_inject_the_clock_rather_than_letting_the_service_read_one', () => {
    expect(sourceOf(ROOT)).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});

describe('statisticsService - what it must not reach', () => {
  /**
   * B5's count of surfaces permitted to decrypt a stored Mercado Pago
   * credential is unchanged by D5. Asserted rather than assumed.
   */
  it('should_build_no_credential_cipher', () => {
    expect(sourceOf(ROOT)).not.toMatch(/WebCryptoCipher|CredentialCipher/);
  });

  it('should_wire_no_supabase_client_and_no_storage', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createSupabaseServerClient|SupabaseClient/);
    expect(source).not.toMatch(/Storage/);
  });

  it('should_wire_no_payment_gateway', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/PaymentGateway|MercadoPago/);
  });

  /**
   * D5 is read-only. A root that could reach a write is a root that will.
   */
  it('should_wire_no_writer_and_no_mail_sender', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/BookingRepository|ClientRepository\b|TransferReceiptRepository/);
    expect(source).not.toMatch(/createEmailSender|EmailSender/);
  });
});

describe('statisticsService - the claim it makes about itself', () => {
  /**
   * The failure this class of test closes (found in C2's verification pass): a
   * root asserting a guarantee no test provided. If the claim goes, this test
   * should go with it; if this test goes, the claim becomes false again.
   */
  it('should_only_claim_a_source_level_assertion_while_this_file_exists', () => {
    const prose = sourceOf(ROOT).replace(/\s*\*\s*/g, ' ');

    expect(prose).toMatch(/asserted by a test over this file's source/);
  });
});
