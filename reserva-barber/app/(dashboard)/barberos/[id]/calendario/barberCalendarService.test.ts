import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, for D3's root.
 *
 * The precedent and the reason are C2's (`(home)/bookingCancellationService`):
 * B4's runtime found a repository wired into one composer and not the other,
 * invisible to a green suite because the page tests mock the composer wholesale
 * and the service tests construct it directly. Neither ever runs the real
 * composer, so it is reviewed as text — the only thing that reaches it.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const ROOT = './barberCalendarService.ts';

describe('barberCalendarService - every dependency is wired', () => {
  it('should_pass_both_collaborators', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(/new PrismaBarberCalendarRepository\(getPrismaClient\(\)\)/);
    expect(source).toMatch(/systemClock/);
  });

  it('should_construct_the_repository_once', () => {
    expect(sourceOf(ROOT).match(/new PrismaBarberCalendarRepository\(/g)).toHaveLength(1);
  });

  /**
   * The check has to precede the construction, not merely be present. A root
   * that built the repository first and asserted afterwards would still refuse,
   * but it would have opened a connection to answer a question about a day it
   * could not place.
   */
  it('should_assert_timezone_support_before_building_anything', () => {
    const source = sourceOf(ROOT);

    const guard = source.indexOf('hasTimezoneSupport()');
    const construction = source.indexOf('new PrismaBarberCalendarRepository');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(construction);
    expect(source).toMatch(/throw new TimezoneUnavailableError\(\)/);
  });
});

describe('barberCalendarService - what it must not reach', () => {
  /**
   * B5's count of surfaces permitted to decrypt a stored Mercado Pago
   * credential is unchanged by D3. Asserted rather than assumed.
   */
  it('should_build_no_credential_cipher', () => {
    expect(sourceOf(ROOT)).not.toMatch(/WebCryptoCipher|CredentialCipher/);
  });

  /** No storage, no signed URL, no session client. This page reads three tables. */
  it('should_wire_no_supabase_client_and_no_storage', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createSupabaseServerClient|SupabaseClient/);
    expect(source).not.toMatch(/Storage/);
  });

  /** D3 is read-only. A root that could reach a write is a root that will. */
  it('should_wire_no_writer_and_no_mail_sender', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/BookingRepository|createEmailSender|EmailSender/);
  });

  /**
   * The projections carrying a client's contact details live on other
   * repositories, and nothing here may reach one.
   */
  it('should_reach_no_contact_projection', () => {
    expect(sourceOf(ROOT)).not.toMatch(/findForConfirmationEmail|TransferReceiptRepository/);
  });
});

describe('barberCalendarService - the claim it makes about itself', () => {
  /**
   * The failure this class of test was written to close (C2's verification
   * pass): a root asserting a guarantee no test provided. If the claim is
   * removed this test should go with it; if this test is removed the claim
   * becomes false again.
   */
  it('should_only_claim_a_source_level_assertion_while_this_file_exists', () => {
    const prose = sourceOf(ROOT).replace(/\s*\*\s*/g, ' ');

    expect(prose).toMatch(/asserted by a test over this file's source/);
  });
});
