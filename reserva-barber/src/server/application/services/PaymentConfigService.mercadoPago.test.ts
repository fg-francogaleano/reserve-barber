import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentConfigService } from './PaymentConfigService';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type {
  IMercadoPagoCredentialVerifier,
  VerificationOutcome,
} from '@/server/domain/repositories/IMercadoPagoCredentialVerifier';
import type { PaymentConfig } from '@/server/domain/models/PaymentConfig';
import { CredentialDecryptionError } from '@/server/domain/errors/PaymentConfigErrors';

const OWNER_ID = 'owner-root';
const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
/** Same shape, different trailing segment. Not an account - see T43. */
const OTHER_ACCOUNT_TOKEN =
  'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-999888777';

const CONFIGURED_TRANSFER = {
  cbuCvu: '2850590940090418135201',
  alias: 'mi.barberia',
  holderName: 'Barberia Franco',
};
const EMPTY_TRANSFER = { cbuCvu: null, alias: null, holderName: null };

function storedConfig(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    id: 'cfg-1',
    ownerId: OWNER_ID,
    mpPublicKey: null,
    hasMercadoPagoCredentials: false,
    transfer: EMPTY_TRANSFER,
    depositType: 'PERCENT',
    depositValue: null,
    updatedAt: new Date('2026-08-13T12:00:00Z'),
    ...overrides,
  };
}

function makeRepository(): IPaymentConfigRepository {
  return {
    findByOwner: vi.fn().mockResolvedValue(null),
    findTransferDetailsForPublic: vi.fn().mockResolvedValue(null),
    upsertTransferDetails: vi.fn().mockResolvedValue(undefined),
    upsertMercadoPagoCredentials: vi.fn().mockResolvedValue(undefined),
    findMercadoPagoPublicKeyForPublic: vi.fn().mockResolvedValue(null),
    findMercadoPagoAccessToken: vi.fn().mockResolvedValue(null),
    upsertDepositPolicy: vi.fn().mockResolvedValue(undefined),
    findDepositPolicyForPublic: vi.fn().mockResolvedValue(null),
    findPaymentReadinessForPublic: vi.fn().mockResolvedValue(null),
  };
}

function makeVerifier(
  outcome: VerificationOutcome = { status: 'verified', account: { displayName: 'BARBERIA' } }
): IMercadoPagoCredentialVerifier {
  return { verify: vi.fn().mockResolvedValue(outcome) };
}

describe('PaymentConfigService - saveMercadoPagoCredentials', () => {
  let repository: IPaymentConfigRepository;

  beforeEach(() => {
    repository = makeRepository();
  });

  describe('first configuration', () => {
    it('should_write_without_asking_for_confirmation', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toEqual({ status: 'saved', verified: true, leavesNoPaymentMethod: false });
      expect(repository.upsertMercadoPagoCredentials).toHaveBeenCalledWith(OWNER_ID, {
        accessToken: TOKEN,
        publicKey: KEY,
      });
    });

    it('should_pass_plaintext_to_the_repository', async () => {
      // Encryption belongs at the persistence boundary (design D2). A service
      // that handed over an envelope would be a service that can log one.
      const service = new PaymentConfigService(repository, makeVerifier());

      await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      const [, credentials] = vi.mocked(repository.upsertMercadoPagoCredentials).mock.calls[0];
      expect(credentials.accessToken).toBe(TOKEN);
    });

    it('should_reject_an_incomplete_pair_as_a_wiring_mistake', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      await expect(
        service.saveMercadoPagoCredentials(
          OWNER_ID,
          { accessToken: TOKEN, publicKey: null },
          { confirmed: false }
        )
      ).rejects.toThrow(/complete credential pair/);
      expect(repository.upsertMercadoPagoCredentials).not.toHaveBeenCalled();
    });
  });

  describe('the verification failure policy (design D5)', () => {
    it('should_write_nothing_when_mercado_pago_rejects_the_credentials', async () => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true })
      );
      const service = new PaymentConfigService(repository, makeVerifier({ status: 'rejected' }));

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: true }
      );

      expect(result).toEqual({ status: 'rejected' });
      expect(repository.upsertMercadoPagoCredentials).not.toHaveBeenCalled();
    });

    it('should_still_write_when_mercado_pago_is_unavailable', async () => {
      // Refusing to save because a third party is down would be this feature
      // failing for a reason unrelated to the owner's input.
      const service = new PaymentConfigService(repository, makeVerifier({ status: 'unavailable' }));

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toEqual({ status: 'saved', verified: false, leavesNoPaymentMethod: false });
      expect(repository.upsertMercadoPagoCredentials).toHaveBeenCalled();
    });

    it('should_verify_before_gating_on_confirmation', async () => {
      // The confirmation displays what verification returns, so it cannot run
      // first — and a token rejected outright never reaches the owner as a
      // confirmation prompt.
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true })
      );
      const service = new PaymentConfigService(repository, makeVerifier({ status: 'rejected' }));

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result.status).toBe('rejected');
    });

    it('should_re_verify_on_the_confirming_round_trip', async () => {
      // A token revoked between the two steps must not be written just because
      // the owner already pressed confirm.
      const verifier = makeVerifier();
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true })
      );
      const service = new PaymentConfigService(repository, verifier);

      await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: TOKEN, publicKey: KEY },
        { confirmed: true }
      );

      expect(verifier.verify).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe('the confirmation gate (design D6)', () => {
    beforeEach(() => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true })
      );
      vi.mocked(repository.findMercadoPagoAccessToken).mockResolvedValue(TOKEN);
    });

    it('should_ask_for_confirmation_before_replacing_stored_credentials', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result.status).toBe('needs_confirmation');
      expect(repository.upsertMercadoPagoCredentials).not.toHaveBeenCalled();
    });

    it('should_never_place_a_credential_in_the_confirmation_payload', async () => {
      // This value is serialized into form state and reaches the browser.
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(OTHER_ACCOUNT_TOKEN);
      expect(serialized).not.toContain(TOKEN);
    });

    it('should_carry_the_account_identity_and_the_stored_last_four', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toMatchObject({
        status: 'needs_confirmation',
        pending: {
          environment: null,
          lastFour: '8777',
          displayName: 'BARBERIA',
          storedLastFour: '3636',
          verified: true,
        },
      });
    });

    it('should_write_once_confirmed', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: true }
      );

      expect(result.status).toBe('saved');
      expect(repository.upsertMercadoPagoCredentials).toHaveBeenCalled();
    });
  });

  /*
   * The "account switch warning" suite (design D6a) was here until 2026-08-13.
   *
   * It asserted that replacing credentials with a token from a different
   * Mercado Pago account produced a prominent warning, derived offline from the
   * token's trailing segment. Every case passed — against fixtures built from
   * the same reference example the implementation was built from. A real
   * credential settled it the other way: trailing segment 1325562541, owner's
   * User ID 156842883.
   *
   * What survives is the identity Mercado Pago itself returns during
   * verification, covered by the confirmation-gate suite above. The gap this
   * leaves is recorded as T43.
   */

  describe('the confirmation identifies the account only when Mercado Pago does', () => {
    beforeEach(() => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true })
      );
      vi.mocked(repository.findMercadoPagoAccessToken).mockResolvedValue(TOKEN);
    });

    it('should_carry_the_name_mercado_pago_returned', async () => {
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toMatchObject({ pending: { displayName: 'BARBERIA', verified: true } });
    });

    // No offline fallback: inventing one is what produced the withdrawn D6a.
    it('should_carry_no_name_when_mercado_pago_was_unreachable', async () => {
      const service = new PaymentConfigService(repository, makeVerifier({ status: 'unavailable' }));

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toMatchObject({ pending: { displayName: null, verified: false } });
    });

    it('should_never_derive_an_account_identifier_from_the_token', async () => {
      // The regression guard for T43. A token's trailing segment is a shape
      // requirement, not an account, and must not reappear as one.
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(JSON.stringify(result)).not.toContain('999888777');
    });

    it('should_still_summarize_when_the_stored_token_is_unreadable', async () => {
      vi.mocked(repository.findMercadoPagoAccessToken).mockRejectedValue(
        new CredentialDecryptionError()
      );
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.saveMercadoPagoCredentials(
        OWNER_ID,
        { accessToken: OTHER_ACCOUNT_TOKEN, publicKey: KEY },
        { confirmed: false }
      );

      expect(result).toMatchObject({ pending: { storedLastFour: null, displayName: 'BARBERIA' } });
    });
  });
});

describe('PaymentConfigService - removeMercadoPagoCredentials', () => {
  let repository: IPaymentConfigRepository;

  beforeEach(() => {
    repository = makeRepository();
  });

  it('should_ask_for_confirmation_before_removing', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true })
    );
    const service = new PaymentConfigService(repository, makeVerifier());

    const result = await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: false });

    expect(result.status).toBe('needs_confirmation');
    expect(repository.upsertMercadoPagoCredentials).not.toHaveBeenCalled();
  });

  it('should_clear_only_the_two_credential_columns', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true, transfer: CONFIGURED_TRANSFER })
    );
    const service = new PaymentConfigService(repository, makeVerifier());

    await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: true });

    expect(repository.upsertMercadoPagoCredentials).toHaveBeenCalledWith(OWNER_ID, {
      accessToken: null,
      publicKey: null,
    });
    expect(repository.upsertTransferDetails).not.toHaveBeenCalled();
  });

  it('should_not_call_mercado_pago_when_removing', async () => {
    // There is nothing to verify, and a removal must not fail because a third
    // party is down.
    const verifier = makeVerifier();
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true })
    );
    const service = new PaymentConfigService(repository, verifier);

    await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: true });

    expect(verifier.verify).not.toHaveBeenCalled();
  });

  describe('the no-payment-method warning', () => {
    it('should_warn_when_no_transfer_destination_remains', async () => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true, transfer: EMPTY_TRANSFER })
      );
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: true });

      expect(result).toEqual({ status: 'removed', leavesNoPaymentMethod: true });
    });

    it('should_not_warn_when_a_transfer_destination_remains', async () => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true, transfer: CONFIGURED_TRANSFER })
      );
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: true });

      expect(result).toEqual({ status: 'removed', leavesNoPaymentMethod: false });
    });

    // An owner migrating between payment methods must not be trapped; the
    // bookability gate belongs to the booking flow.
    it('should_permit_a_removal_that_leaves_the_business_unbookable', async () => {
      vi.mocked(repository.findByOwner).mockResolvedValue(
        storedConfig({ hasMercadoPagoCredentials: true, transfer: EMPTY_TRANSFER })
      );
      const service = new PaymentConfigService(repository, makeVerifier());

      const result = await service.removeMercadoPagoCredentials(OWNER_ID, { confirmed: true });

      expect(result.status).toBe('removed');
    });
  });
});

describe('PaymentConfigService - getMercadoPagoView', () => {
  let repository: IPaymentConfigRepository;

  beforeEach(() => {
    repository = makeRepository();
  });

  it('should_report_unconfigured_when_no_row_exists', async () => {
    const service = new PaymentConfigService(repository, makeVerifier());

    expect(await service.getMercadoPagoView(OWNER_ID)).toEqual({
      configured: false,
      publicKey: null,
      environment: null,
      lastFour: null,
      changedAt: null,
      unreadable: false,
    });
  });

  it('should_report_the_account_and_last_four_without_the_token', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true, mpPublicKey: KEY })
    );
    vi.mocked(repository.findMercadoPagoAccessToken).mockResolvedValue(TOKEN);
    const service = new PaymentConfigService(repository, makeVerifier());

    const view = await service.getMercadoPagoView(OWNER_ID);

    expect(view).toEqual({
      configured: true,
      publicKey: KEY,
      // Never "production": an `APP_USR-` credential may be test or live, so
      // the page must not claim otherwise. The account id is shown instead, and
      // unlike the environment it is a fact recovered from the token.
      environment: null,
      lastFour: '3636',
      changedAt: new Date('2026-08-13T12:00:00Z'),
      unreadable: false,
    });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
  });

  // Design D12: without this the page renders a healthy-looking "configured"
  // state over a token nobody can read, and B5 discovers it in a real payment.
  it('should_report_unreadable_as_its_own_state', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true, mpPublicKey: KEY })
    );
    vi.mocked(repository.findMercadoPagoAccessToken).mockRejectedValue(
      new CredentialDecryptionError()
    );
    const service = new PaymentConfigService(repository, makeVerifier());

    const view = await service.getMercadoPagoView(OWNER_ID);

    expect(view).toMatchObject({ configured: true, unreadable: true, lastFour: null });
  });

  it('should_distinguish_unreadable_from_unconfigured', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true })
    );
    vi.mocked(repository.findMercadoPagoAccessToken).mockRejectedValue(
      new CredentialDecryptionError()
    );
    const service = new PaymentConfigService(repository, makeVerifier());

    const unreadable = await service.getMercadoPagoView(OWNER_ID);

    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());
    const unconfigured = await service.getMercadoPagoView(OWNER_ID);

    expect(unreadable.configured).toBe(true);
    expect(unconfigured.configured).toBe(false);
    expect(unreadable.unreadable).not.toBe(unconfigured.unreadable);
  });

  it('should_propagate_an_unexpected_read_failure_rather_than_reporting_it_as_unreadable', async () => {
    // A dropped connection is not a corrupt credential, and telling the owner
    // to re-enter their credentials would be the wrong advice.
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true })
    );
    vi.mocked(repository.findMercadoPagoAccessToken).mockRejectedValue(new Error('connection lost'));
    const service = new PaymentConfigService(repository, makeVerifier());

    await expect(service.getMercadoPagoView(OWNER_ID)).rejects.toThrow('connection lost');
  });
});
