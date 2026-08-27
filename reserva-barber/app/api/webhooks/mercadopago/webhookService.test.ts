import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, extended to the two roots N1 rewires.
 *
 * B4 added this shape of test after its runtime found a repository wired into
 * one composer and not the other — a defect invisible to 2061 passing tests,
 * because the page tests mocked the composer wholesale and the service tests
 * constructed it directly. Neither ever ran the real composer, so the composer
 * is reviewed as text, which is the only thing that reaches it.
 *
 * N1 is exactly that class of change: it adds a collaborator to two roots at
 * once, and a root that got five arguments instead of six would typecheck,
 * pass every service test, and silently stop telling clients their appointments
 * are real.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const WEBHOOK_ROOT = './webhookService.ts';
const RECEIPT_ROOT = '../../../(dashboard)/comprobantes/receiptReviewService.ts';

describe('webhookService - every dependency is wired', () => {
  it('should_pass_all_six_collaborators', () => {
    const source = sourceOf(WEBHOOK_ROOT);

    expect(source).toMatch(/new PrismaPaymentRepository\(db\)/);
    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db, new WebCryptoCipher\(\)\)/);
    expect(source).toMatch(/new MercadoPagoGateway\(\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
    expect(source).toMatch(/new BookingConfirmationNotificationService\(/);
  });

  it('should_build_the_notification_service_with_all_five_of_its_own', () => {
    const source = sourceOf(WEBHOOK_ROOT);

    expect(source).toMatch(/new PrismaBookingRepository\(db\)/);
    // The capability, not just the factory. A root that passed the wrong one
    // would compile and pass every other assertion here — which is exactly how
    // the cancellation notice came to report itself as a failed confirmation.
    expect(source).toMatch(/createEmailSender\(logger, BOOKING_CONFIRMATION_EMAIL\)/);
    expect(source).toMatch(/resolveOrigin\(\{ configured: process\.env\.APP_ORIGIN \}\)/);
  });

  /**
   * The claim this file used to make about itself was that it wired no booking
   * repository, because the notification never read a booking. N1 made that
   * false. A comment asserting a property the code no longer has is worse than
   * no comment: every later reviewer trusts it.
   */
  it('should_no_longer_claim_that_it_wires_no_booking_repository', () => {
    const source = sourceOf(WEBHOOK_ROOT);

    expect(source).not.toMatch(/No booking repository/);
    expect(source).toMatch(/narrowed guarantee/i);
  });

  /**
   * The credential rule is B5's and is untouched by N1. Asserted here because
   * this root is now bigger, and a bigger root is where an extra read gets
   * added without anyone noticing what it can reach.
   */
  it('should_still_be_the_only_public_flow_root_that_builds_a_cipher_here', () => {
    const source = sourceOf(WEBHOOK_ROOT);

    expect(source.match(/new WebCryptoCipher\(\)/g)).toHaveLength(1);
  });

  it('should_wire_no_supabase_client', () => {
    // No session, nothing to upload. Unchanged by N1.
    expect(sourceOf(WEBHOOK_ROOT)).not.toMatch(/createSupabaseServerClient|SupabaseClient/);
  });

  /**
   * A global startup check for this key would take down payment confirmation
   * over a missing mail credential — "clients are not being emailed" becoming
   * "money moves and no booking confirms".
   */
  it('should_read_the_provider_key_through_the_feature_factory_only', () => {
    const source = sourceOf(WEBHOOK_ROOT);

    expect(source).not.toMatch(/process.env.RESEND_API_KEY/);
    expect(source).toMatch(/createEmailSender/);
  });
});

describe('receiptReviewService - every dependency is wired', () => {
  it('should_pass_all_five_collaborators', () => {
    const source = sourceOf(RECEIPT_ROOT);

    expect(source).toMatch(/new PrismaTransferReceiptRepository\(db\)/);
    expect(source).toMatch(/new SupabaseOwnerReceiptStorage\(/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
    expect(source).toMatch(/new BookingConfirmationNotificationService\(/);
  });

  it('should_build_the_notification_service_with_all_five_of_its_own', () => {
    const source = sourceOf(RECEIPT_ROOT);

    expect(source).toMatch(/new PrismaBookingRepository\(db\)/);
    // The capability, not just the factory. A root that passed the wrong one
    // would compile and pass every other assertion here — which is exactly how
    // the cancellation notice came to report itself as a failed confirmation.
    expect(source).toMatch(/createEmailSender\(logger, BOOKING_CONFIRMATION_EMAIL\)/);
    expect(source).toMatch(/resolveOrigin\(\{ configured: process\.env\.APP_ORIGIN \}\)/);
  });

  /**
   * B5's count of public-flow surfaces permitted to decrypt a credential is
   * unchanged by N1, and this root is not one of them.
   */
  it('should_build_no_cipher', () => {
    expect(sourceOf(RECEIPT_ROOT)).not.toMatch(/WebCryptoCipher/);
  });

  it('should_read_the_provider_key_through_the_feature_factory_only', () => {
    expect(sourceOf(RECEIPT_ROOT)).not.toMatch(/process.env.RESEND_API_KEY/);
  });
});
