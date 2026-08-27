import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, for C2's root.
 *
 * **This file exists because the root claimed it did.** Its doc comment said
 * "every one asserted by a test over this file's source" while no such test
 * existed — found in C2's own verification pass, and exactly the failure N1's
 * review had flagged one story earlier: a comment asserting a guarantee that is
 * not there is worse than no comment, because every later reviewer trusts it.
 *
 * The reason the guarantee needs a test at all is B4's: its runtime found a
 * repository wired into one composer and not the other, invisible to a green
 * suite because the page tests mocked the composer wholesale and the service
 * tests constructed it directly. Neither ever ran the real composer — and
 * `actions.test.ts` mocks this one the same way. The composer is therefore
 * reviewed as text, which is the only thing that reaches it.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const ROOT = './bookingCancellationService.ts';

describe('bookingCancellationService - every dependency is wired', () => {
  /**
   * Four arguments, each asserted by name. A root that passed three would
   * compile, typecheck and pass every service unit test — and would surface as
   * an owner cancelling bookings whose clients are never told.
   */
  it('should_pass_all_four_collaborators', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(/new PrismaBookingRepository\(getPrismaClient\(\)\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
    expect(source).toMatch(/new BookingCancellationNotificationService\(/);
  });

  it('should_build_the_notification_service_with_all_three_of_its_own', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(/new BookingCancellationNotificationService\(\s*bookings,/);
    // **The capability, not just the factory.** This root passed only `logger`,
    // so the shared sender reported every unsendable cancellation as a failed
    // *confirmation*, under the confirmation's operation name — live in
    // production, on the only mail path an owner could reach while no provider
    // key was set. Nothing here could see it: the factory was named, and the
    // factory was right.
    expect(source).toMatch(/createEmailSender\(logger, BOOKING_CANCELLATION_EMAIL\)/);
    expect(source).not.toMatch(/BOOKING_CONFIRMATION_EMAIL/);
  });

  /**
   * One repository instance shared by both services, so the notice reuses the
   * confirmation projection rather than opening a second read of the same row.
   */
  it('should_construct_the_repository_once_and_share_it', () => {
    const source = sourceOf(ROOT);

    expect(source.match(/new PrismaBookingRepository\(/g)).toHaveLength(1);
    expect(source).toMatch(/const bookings = new PrismaBookingRepository/);
  });
});

describe('bookingCancellationService - what it must not reach', () => {
  /**
   * B5's count of surfaces permitted to decrypt a stored Mercado Pago
   * credential is unchanged by C2, and this root is not one of them. Asserted
   * rather than assumed, because this root grew from three collaborators to
   * five across two services during the story.
   */
  it('should_build_no_credential_cipher', () => {
    expect(sourceOf(ROOT)).not.toMatch(/WebCryptoCipher|CredentialCipher/);
  });

  /**
   * No storage, no signed URL, no session client. This write touches a booking
   * and nothing else.
   */
  it('should_wire_no_supabase_client_and_no_storage', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createSupabaseServerClient|SupabaseClient/);
    expect(source).not.toMatch(/Storage/);
  });

  /**
   * A global startup check for the provider key would take down the dashboard
   * home over a missing mail credential — the rule N1 established, and this
   * root is the second place it applies.
   */
  it('should_read_the_provider_key_through_the_feature_factory_only', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/process\.env\.RESEND_API_KEY/);
    expect(source).toMatch(/createEmailSender/);
  });

  /**
   * The projection carrying the client's email exists on the repository this
   * root wires, and the cancellation service never calls it — only the notice
   * does. Asserted here so the root cannot start handing it to the dashboard.
   */
  it('should_not_reach_the_confirmation_projection_itself', () => {
    expect(sourceOf(ROOT)).not.toMatch(/findForConfirmationEmail/);
  });
});

describe('bookingCancellationService - the claim it makes about itself', () => {
  /**
   * The specific failure this file was written to close: the comment asserted a
   * test that did not exist. If the claim is ever removed the test should go
   * with it, and if the test is ever removed the claim becomes false again.
   */
  it('should_only_claim_a_source_level_assertion_while_this_file_exists', () => {
    const source = sourceOf(ROOT);

    // Newline-tolerant: the claim wraps across a doc-comment line.
    const prose = source.replace(/\s*\*\s*/g, ' ');
    expect(prose).toMatch(/asserted by a test over this file's source/);
  });
});
