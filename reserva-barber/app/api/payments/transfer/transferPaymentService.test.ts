import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, applied to the bank transfer root.
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

describe('transferPaymentService - every dependency is wired', () => {
  /**
   * Seven arguments, each asserted by name. T57 in one test: a missing argument
   * here would compile, typecheck and pass every service unit test, and would
   * surface as a client unable to pay at a shop that is correctly configured —
   * exactly the defect B4 shipped and caught by hand at runtime.
   */
  it('should_pass_all_seven_collaborators', () => {
    const source = sourceOf('./transferPaymentService.ts');

    expect(source).toMatch(/new PrismaBookingRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db\)/);
    expect(source).toMatch(/new PrismaTransferReceiptRepository\(db\)/);
    expect(source).toMatch(/new SupabaseReceiptStorage\(createSupabaseAnonClient\(\)\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
  });

  /**
   * **This root must never grow a cipher.**
   *
   * B5 made the Mercado Pago initiation one of exactly two surfaces in the
   * public flow permitted to decrypt the access token, and B6 does not change
   * that count. This path renders a CBU — three plaintext columns nobody
   * encrypts — so its payment config repository is built without one, the way
   * B4's booking write builds its own. The cipher argument is optional in that
   * constructor for PC1's sake, and optional is precisely what T57 warns about,
   * so the absence is asserted rather than assumed.
   */
  it('should_not_construct_a_cipher', () => {
    const source = sourceOf('./transferPaymentService.ts');

    expect(importLinesOf('./transferPaymentService.ts')).not.toMatch(/WebCryptoCipher/);
    expect(source).not.toMatch(/new WebCryptoCipher\(\)/);
  });

  /**
   * The sessionless client is confined to the uploader.
   *
   * `SupabaseReceiptStorage` can only upload; reading and signing live on a
   * separate class that takes the owner's session. Wiring the sessionless
   * client into anything else here would put an unauthenticated credential on a
   * path that reads other people's bank documents.
   */
  it('should_use_the_anonymous_client_only_for_the_uploader', () => {
    const source = sourceOf('./transferPaymentService.ts');

    const anonUses = source.match(/createSupabaseAnonClient\(\)/g) ?? [];
    expect(anonUses).toHaveLength(1);
    expect(source).not.toMatch(/SupabaseOwnerReceiptStorage/);
  });

  /** Server-only, like every other composition root in this project. */
  it('should_be_server_only', () => {
    expect(sourceOf('./transferPaymentService.ts')).toMatch(/^import 'server-only';/m);
  });
});
