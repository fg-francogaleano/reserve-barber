import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The composition root's two jobs, both of which are about what is **absent**.
 *
 * Neither is verifiable by reading the file once and trusting it: the timezone
 * assertion protects against a silent three-hour shift, and the absent
 * dependencies are a promise that only holds until someone adds a convenient
 * import.
 */

const getPrismaClient = vi.fn(() => ({}) as never);
const hasTimezoneSupport = vi.fn(() => true);

// `server-only` exists to make Next fail a client import at build time; it has
// no resolvable module under the test runner.
vi.mock('server-only', () => ({}));

vi.mock('@/server/infrastructure/prisma/client', () => ({
  getPrismaClient: () => getPrismaClient(),
}));
vi.mock('@/server/domain/models/businessTime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/domain/models/businessTime')>()),
  hasTimezoneSupport: () => hasTimezoneSupport(),
}));

const { bookingCatalogService, TimezoneUnavailableError } = await import('./bookingCatalogService');

afterEach(() => {
  vi.clearAllMocks();
  hasTimezoneSupport.mockReturnValue(true);
  getPrismaClient.mockReturnValue({} as never);
});

describe('bookingCatalogService - the timezone assertion', () => {
  it('should_build_the_service_when_the_runtime_carries_timezone_data', () => {
    expect(() => bookingCatalogService()).not.toThrow();
  });

  it('should_refuse_to_build_anything_when_it_does_not', () => {
    // A runtime without tzdata does not throw — it reports UTC. Every offered
    // time would be three hours off and every one would look plausible, so the
    // only safe answer is to fail before a single time is computed.
    hasTimezoneSupport.mockReturnValue(false);

    expect(() => bookingCatalogService()).toThrow(TimezoneUnavailableError);
  });

  it('should_refuse_before_constructing_the_database_client', () => {
    // The assertion is worth having only if it runs first. Building the client
    // and the repositories and then throwing would spend a connection on a
    // request that cannot be answered.
    hasTimezoneSupport.mockReturnValue(false);

    expect(() => bookingCatalogService()).toThrow(TimezoneUnavailableError);
    expect(getPrismaClient).not.toHaveBeenCalled();
  });

  it('should_carry_no_internal_detail_in_the_failure', () => {
    hasTimezoneSupport.mockReturnValue(false);

    const failure = (() => {
      try {
        bookingCatalogService();
        return null;
      } catch (error) {
        return error as Error;
      }
    })();

    expect(failure?.message).not.toMatch(/DATABASE_URL|postgres|PAYMENT_CREDENTIALS_KEY/);
  });
});

describe('bookingCatalogService - what must stay absent', () => {
  it('should_import_no_supabase_client_and_no_cipher', async () => {
    // B1 wrote this list down and B2 inherited it. It is now two items rather
    // than three: B4 wires the payment repository (see below), and the token it
    // was protecting is protected by a projection instead.
    //
    // The assertion is over the **import lines**, not the file text: the file
    // names both in prose to explain why they are absent, and a text scan would
    // fail on the very comments that document the decision. What decides whether
    // something is constructed is whether it is imported.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./bookingCatalogService.ts', import.meta.url), 'utf8')
    );
    const imports = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');

    expect(imports).not.toMatch(/supabase|createClient/i);
    expect(imports).not.toMatch(/Cipher/i);
    // And the list is not empty for a trivial reason — the file does import.
    expect(imports).toMatch(/PublicBookingCatalogService/);
  });

  it('should_wire_the_payment_repository_so_the_details_step_can_price_a_deposit', async () => {
    // **This is the test that would have caught B4's runtime defect.** The
    // service takes the payment repository as an OPTIONAL fifth argument, so
    // omitting it compiles, every unit test passes, and the details step then
    // renders "esta barbería no está tomando reservas online" for a shop whose
    // deposit is perfectly well configured. Found by the group 11 runtime
    // verification, not by the suite; pinned here so it stays found.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./bookingCatalogService.ts', import.meta.url), 'utf8')
    );

    expect(source).toMatch(/new PrismaPaymentConfigRepository\(db\)/);
    // With no second argument: no cipher, so a method that decrypts would throw
    // here rather than quietly returning a token in the clear.
    expect(source).not.toMatch(/new PrismaPaymentConfigRepository\(db,/);
  });
});
