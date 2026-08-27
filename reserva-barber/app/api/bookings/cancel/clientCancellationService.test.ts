import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The composition-root review, for C1's root.
 *
 * Written **with** the claim it verifies, not after it. C2's root asserted
 * "every one asserted by a test over this file's source" while no such test
 * existed, and N1's review had flagged the same class of false claim one story
 * earlier. A comment asserting a guarantee that is not there is worse than no
 * comment, because every later reviewer trusts it.
 *
 * The guarantee needs a text-level test because nothing else reaches this file:
 * `route.test.ts` mocks the composer wholesale and the service tests construct
 * the service directly.
 */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

const ROOT = './clientCancellationService.ts';

describe('clientCancellationService - every dependency is wired', () => {
  /**
   * Three arguments, each asserted by name. A root that passed two would
   * compile, typecheck and pass every service unit test.
   */
  it('should_pass_all_three_collaborators', () => {
    const source = sourceOf(ROOT);

    expect(source).toMatch(/new PrismaBookingRepository\(getPrismaClient\(\)\)/);
    expect(source).toMatch(/systemClock/);
    expect(source).toMatch(/logger/);
  });

  it('should_construct_the_repository_exactly_once', () => {
    expect(sourceOf(ROOT).match(/new PrismaBookingRepository\(/g)).toHaveLength(1);
  });

  it('should_take_no_optional_argument', () => {
    // T57: an omitted optional argument compiles, typechecks and passes every
    // unit test that constructs the service directly.
    expect(sourceOf(ROOT)).not.toMatch(/\?\s*:/);
  });
});

describe('clientCancellationService - what it must not reach', () => {
  /**
   * B5 fixed at two the number of surfaces in the public flow permitted to
   * decrypt a stored Mercado Pago access token. C1 is not a third — which is
   * also why cancelling does not close the client's open checkout.
   */
  it('should_build_no_credential_cipher', () => {
    expect(sourceOf(ROOT)).not.toMatch(/WebCryptoCipher|CredentialCipher/);
  });

  /**
   * Nobody is notified by this path. The decision is recorded in the story's
   * design; asserted here so it cannot be reversed by wiring alone.
   */
  it('should_wire_no_email_sender', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createEmailSender|EmailSender|Notification/);
    expect(source).not.toMatch(/RESEND_API_KEY/);
  });

  it('should_wire_no_supabase_client_and_no_storage', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/createSupabase\w*|SupabaseClient/);
    expect(source).not.toMatch(/Storage/);
  });

  /**
   * The projection carrying the client's email address exists on the repository
   * this root wires, and nothing on this path may call it: no message is sent,
   * so no address is needed.
   */
  it('should_not_reach_the_projection_that_carries_an_address', () => {
    expect(sourceOf(ROOT)).not.toMatch(/findForConfirmationEmail/);
  });

  /**
   * The owner-scoped cancellation is a different write with a different
   * credential. This root must not be able to reach it.
   */
  it('should_not_wire_the_owner_scoped_cancellation_service', () => {
    expect(sourceOf(ROOT)).not.toMatch(/\bBookingCancellationService\b/);
  });
});

describe('clientCancellationService - the claim it makes about itself', () => {
  it('should_only_claim_a_source_level_assertion_while_this_file_exists', () => {
    // Newline-tolerant: the claim wraps across doc-comment lines.
    const prose = sourceOf(ROOT).replace(/\s*\*\s*/g, ' ');

    expect(prose).toMatch(/asserted by a test over this file's source/);
  });
});

/**
 * The scenario `payment-mercado-pago` states and nothing else asserted: this
 * path makes no call to Mercado Pago.
 *
 * Cancelling deliberately does **not** close the client's open checkout —
 * doing so would need an authenticated call with the owner's access token,
 * making this a third composition root permitted to decrypt it against B5's
 * fixed count of two. The absence was argued in the design and guarded only by
 * the cipher assertion above, which is a weaker claim: a gateway wired here
 * without a cipher would still be a call this path must not make.
 */
describe('clientCancellationService - it never reaches the gateway', () => {
  it('should_wire_no_mercado_pago_gateway', () => {
    const source = sourceOf(ROOT);

    expect(source).not.toMatch(/MercadoPago|Gateway/);
  });

  it('should_wire_no_payment_repository_at_all', () => {
    // The payment write lives inside the booking repository's transaction, so
    // this path needs no payment port — and one wired here would be a second
    // way to touch money outside that transaction.
    expect(sourceOf(ROOT)).not.toMatch(/PrismaPaymentRepository|PaymentConfigRepository/);
  });
});
