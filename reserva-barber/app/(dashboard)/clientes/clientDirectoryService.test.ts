import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, for D4's root.
 *
 * The precedent and the reason are C2's and D3's: page tests mock the composer
 * wholesale and service tests construct it directly, so nothing in the suite
 * ever runs the real composer. It is reviewed as text, which is the only thing
 * that reaches it.
 *
 * It matters more here than usual. This is the first surface in the product to
 * render a guest's email address and telephone number, and what makes that
 * acceptable is entirely the constraints around it — so a root that quietly
 * grew a mail sender or a storage client would be a change in what this page
 * *is*, not a change in how it is wired.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const ROOT = './clientDirectoryService.ts';

describe('clientDirectoryService - what it wires', () => {
  it('should_pass_its_one_collaborator', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(
      /new ClientDirectoryService\(new PrismaClientDirectoryRepository\(getPrismaClient\(\)\)\)/
    );
  });

  it('should_construct_the_repository_once', () => {
    expect(sourceOf(ROOT).match(/new PrismaClientDirectoryRepository\(/g)).toHaveLength(1);
  });
});

describe('clientDirectoryService - what it must not reach', () => {
  /**
   * B5's count of surfaces permitted to decrypt a stored Mercado Pago
   * credential is unchanged by D4. Asserted rather than assumed.
   */
  it('should_build_no_credential_cipher', () => {
    expect(sourceOf(ROOT)).not.toMatch(/WebCryptoCipher|CredentialCipher/);
  });

  it('should_wire_no_supabase_client_and_no_storage', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createSupabaseServerClient|SupabaseClient/);
    expect(source).not.toMatch(/Storage/);
  });

  /**
   * D4 is read-only. A root that could reach a write is a root that will —
   * and on this page a write would touch a stranger's stored personal data.
   */
  it('should_wire_no_writer_and_no_mail_sender', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/BookingRepository|ClientRepository\b/);
    expect(source).not.toMatch(/createEmailSender|EmailSender/);
  });

  /**
   * The logger stays with the page. A service that could log is a service that
   * could log a client's contact details, which is the one thing this
   * capability's spec forbids by name.
   */
  it('should_not_hand_a_logger_to_the_service', () => {
    expect(sourceOf(ROOT)).not.toMatch(/new ClientDirectoryService\([^)]*logger/);
  });
});

describe('clientDirectoryService - the claim it makes about itself', () => {
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
