import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentConfigService } from './PaymentConfigService';
import { PaymentConfigWriteConflictError } from '@/server/domain/errors/PaymentConfigErrors';
import { Service } from '@/server/domain/models/Service';
import { MIN_DEPOSIT_AMOUNT } from '@/server/domain/models/depositPolicy';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';
import type { PaymentConfig } from '@/server/domain/models/PaymentConfig';

const OWNER = 'owner-root';
const CBU = '2850590940090418135201';

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    id: 'cfg-1',
    ownerId: OWNER,
    mpPublicKey: null,
    hasMercadoPagoCredentials: false,
    transfer: { cbuCvu: null, alias: null, holderName: null },
    depositType: 'PERCENT',
    depositValue: null,
    updatedAt: new Date('2026-08-14T12:00:00Z'),
    ...overrides,
  };
}

const withTransfer = { cbuCvu: CBU, alias: null, holderName: 'Barberia Franco' };

function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
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

function makeServices(services: Service[] = []): IServiceRepository {
  return {
    findAllByOwner: vi.fn().mockResolvedValue(services),
    findByIdForOwner: vi.fn().mockResolvedValue(null),
    countActiveByOwner: vi.fn().mockResolvedValue(services.length),
    existsByOwnerAndName: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as IServiceRepository;
}

function service(name: string, price: string): Service {
  return new Service(`svc-${name}`, name, null, price, 30, true);
}

beforeEach(() => vi.clearAllMocks());

describe('PaymentConfigService - saveDepositPolicy confirmation gate', () => {
  it('should_write_a_first_policy_without_confirmation', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config());

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    expect(result.status).toBe('saved');
    expect(repo.upsertDepositPolicy).toHaveBeenCalledWith(OWNER, { type: 'PERCENT', value: '30' });
  });

  it('should_write_a_first_policy_when_no_row_exists_at_all', async () => {
    const repo = makeRepository();

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'FIXED', value: '2000.00' },
      { confirmed: false }
    );

    expect(result.status).toBe('saved');
  });

  /**
   * Friction on every save is friction that gets clicked through, which would
   * disarm the confirmation in the one case it exists for.
   */
  it('should_write_an_unchanged_re_save_without_confirmation', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '30.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    expect(result.status).toBe('saved');
  });

  it('should_require_confirmation_when_replacing_a_stored_policy', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '3.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    expect(result.status).toBe('needs_confirmation');
    expect(repo.upsertDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_require_confirmation_when_only_the_type_changes', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '50.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'FIXED', value: '50.00' },
      { confirmed: false }
    );

    expect(result.status).toBe('needs_confirmation');
  });

  it('should_write_once_the_owner_confirms', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '3.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: true }
    );

    expect(result.status).toBe('saved');
    expect(repo.upsertDepositPolicy).toHaveBeenCalled();
  });
});

describe('PaymentConfigService - the effect preview', () => {
  it('should_list_each_service_with_the_deposit_the_policy_would_charge', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '10.00' })
    );
    const services = makeServices([service('Corte', '8000.00'), service('Barba', '3000.00')]);

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    if (result.status !== 'needs_confirmation') throw new Error('expected a confirmation');
    expect(result.pending.effects).toEqual([
      expect.objectContaining({ serviceName: 'Corte', price: '8000.00', deposit: '2400.00' }),
      expect.objectContaining({ serviceName: 'Barba', price: '3000.00', deposit: '900.00' }),
    ]);
  });

  it('should_return_an_empty_effect_list_for_an_owner_with_no_services', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '10.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    if (result.status !== 'needs_confirmation') throw new Error('expected a confirmation');
    expect(result.pending.effects).toEqual([]);
  });

  it('should_carry_the_stored_policy_alongside_the_submitted_one', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '3.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    if (result.status !== 'needs_confirmation') throw new Error('expected a confirmation');
    expect(result.pending.stored).toEqual({ type: 'PERCENT', value: '3.00' });
    expect(result.pending.policy).toEqual({ type: 'PERCENT', value: '30' });
  });
});

describe('PaymentConfigService - save warnings', () => {
  it('should_name_the_services_a_fixed_deposit_exceeds', async () => {
    const repo = makeRepository();
    const services = makeServices([
      service('Corte', '3000.00'),
      service('Barba', '2000.00'),
      service('Color', '9000.00'),
    ]);

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'FIXED', value: '5000.00' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.servicesBelowDeposit.map((s) => s.serviceName)).toEqual(['Corte', 'Barba']);
  });

  it('should_report_no_exceeded_services_when_the_deposit_is_below_every_price', async () => {
    const repo = makeRepository();
    const services = makeServices([service('Corte', '8000.00')]);

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'FIXED', value: '2000.00' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.servicesBelowDeposit).toEqual([]);
  });

  /**
   * Without this the failure appears for the first time in a client's checkout,
   * as a payment the gateway refuses to create.
   */
  it('should_name_the_services_whose_deposit_falls_under_the_minimum', async () => {
    const repo = makeRepository();
    const services = makeServices([service('Corte', '8000.00'), service('Flequillo', '50.00')]);

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '1' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.servicesBelowMinimum.map((s) => s.serviceName)).toEqual(['Flequillo']);
    expect(result.servicesBelowMinimum[0]?.deposit).toBe(MIN_DEPOSIT_AMOUNT);
  });

  it('should_warn_when_the_save_leaves_no_payment_method', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config());

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.leavesNoPaymentMethod).toBe(true);
  });

  it('should_not_warn_when_a_transfer_destination_exists', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config({ transfer: withTransfer }));

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.leavesNoPaymentMethod).toBe(false);
  });
});

describe('PaymentConfigService - removeDepositPolicy', () => {
  it('should_require_confirmation_when_a_policy_is_stored', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '30.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).removeDepositPolicy(
      OWNER,
      { confirmed: false }
    );

    expect(result.status).toBe('needs_confirmation');
    expect(repo.upsertDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_clear_the_policy_once_confirmed', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '30.00' })
    );

    const result = await new PaymentConfigService(repo, undefined, makeServices()).removeDepositPolicy(
      OWNER,
      { confirmed: true }
    );

    expect(result.status).toBe('removed');
    expect(repo.upsertDepositPolicy).toHaveBeenCalledWith(OWNER, null);
  });

  it('should_be_a_no_op_confirmation_when_nothing_is_stored', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config());

    const result = await new PaymentConfigService(repo, undefined, makeServices()).removeDepositPolicy(
      OWNER,
      { confirmed: false }
    );

    expect(result.status).toBe('removed');
  });

  /**
   * Removing nothing must not write. The upsert would otherwise create a
   * configuration row holding no configuration, for an owner who has never
   * saved anything — a row whose only content is the absence of content.
   */
  it('should_write_nothing_when_there_is_no_policy_to_remove', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config());

    await new PaymentConfigService(repo, undefined, makeServices()).removeDepositPolicy(OWNER, {
      confirmed: true,
    });

    expect(repo.upsertDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_write_nothing_when_no_row_exists_at_all', async () => {
    const repo = makeRepository();

    const result = await new PaymentConfigService(repo, undefined, makeServices()).removeDepositPolicy(
      OWNER,
      { confirmed: true }
    );

    expect(result.status).toBe('removed');
    expect(repo.upsertDepositPolicy).not.toHaveBeenCalled();
  });
});

describe('PaymentConfigService - a failed preview never masks a successful write', () => {
  /**
   * The warnings are computed after the write, and they are cosmetic. If that
   * read fails, the policy is already stored — reporting the whole save as an
   * infrastructure failure would tell the owner their money rule did not save
   * when it did.
   */
  it('should_report_the_save_when_the_effect_read_fails_afterwards', async () => {
    const repo = makeRepository();
    const services = makeServices();
    vi.mocked(services.findAllByOwner)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('connection lost'));

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    expect(result.status).toBe('saved');
    expect(repo.upsertDepositPolicy).toHaveBeenCalled();
  });

  it('should_report_no_warnings_rather_than_stale_ones_when_the_effect_read_fails', async () => {
    const repo = makeRepository();
    const services = makeServices();
    vi.mocked(services.findAllByOwner).mockRejectedValue(new Error('connection lost'));

    const result = await new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
      OWNER,
      { type: 'FIXED', value: '5000.00' },
      { confirmed: false }
    );

    if (result.status !== 'saved') throw new Error('expected a save');
    expect(result.servicesBelowDeposit).toEqual([]);
    expect(result.servicesBelowMinimum).toEqual([]);
  });

  /**
   * The confirmation preview is a different matter: it runs BEFORE any write,
   * and a confirmation screen with no effects is the thing it exists to show.
   * That failure must still surface.
   */
  it('should_still_surface_a_failure_while_building_the_confirmation', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'PERCENT', depositValue: '3.00' })
    );
    const services = makeServices();
    vi.mocked(services.findAllByOwner).mockRejectedValue(new Error('connection lost'));

    await expect(
      new PaymentConfigService(repo, undefined, services).saveDepositPolicy(
        OWNER,
        { type: 'PERCENT', value: '30' },
        { confirmed: false }
      )
    ).rejects.toThrow('connection lost');

    expect(repo.upsertDepositPolicy).not.toHaveBeenCalled();
  });
});

describe('PaymentConfigService - a lost race on the singleton row', () => {
  it('should_retry_once_and_report_success', async () => {
    const repo = makeRepository();
    vi.mocked(repo.upsertDepositPolicy)
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(undefined);

    const result = await new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
      OWNER,
      { type: 'PERCENT', value: '30' },
      { confirmed: false }
    );

    expect(result.status).toBe('saved');
    expect(repo.upsertDepositPolicy).toHaveBeenCalledTimes(2);
  });

  it('should_surface_a_second_violation_as_a_write_conflict', async () => {
    const repo = makeRepository();
    vi.mocked(repo.upsertDepositPolicy).mockRejectedValue(uniqueViolation());

    await expect(
      new PaymentConfigService(repo, undefined, makeServices()).saveDepositPolicy(
        OWNER,
        { type: 'PERCENT', value: '30' },
        { confirmed: false }
      )
    ).rejects.toBeInstanceOf(PaymentConfigWriteConflictError);
  });
});

describe('PaymentConfigService - getPaymentReadiness', () => {
  it('should_report_ready_with_a_transfer_destination_and_a_policy', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ transfer: withTransfer, depositValue: '30.00' })
    );

    const readiness = await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(readiness).toEqual({ ready: true, hasPaymentMethod: true, hasDepositPolicy: true });
  });

  it('should_report_ready_with_mercado_pago_and_a_policy', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ hasMercadoPagoCredentials: true, depositValue: '30.00' })
    );

    const readiness = await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(readiness.ready).toBe(true);
  });

  it('should_report_not_ready_with_a_payment_method_and_no_policy', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config({ transfer: withTransfer }));

    const readiness = await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(readiness).toEqual({ ready: false, hasPaymentMethod: true, hasDepositPolicy: false });
  });

  it('should_report_not_ready_with_a_policy_and_no_payment_method', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(config({ depositValue: '30.00' }));

    const readiness = await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(readiness).toEqual({ ready: false, hasPaymentMethod: false, hasDepositPolicy: true });
  });

  it('should_report_not_ready_when_no_row_exists', async () => {
    const repo = makeRepository();

    const readiness = await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(readiness).toEqual({ ready: false, hasPaymentMethod: false, hasDepositPolicy: false });
  });

  /**
   * A page about deposit amounts must not fail because of a secret belonging to
   * a different feature. The presence flag the repository already derives
   * answers this without touching the cipher (design D10).
   */
  it('should_never_read_the_access_token', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ hasMercadoPagoCredentials: true, depositValue: '30.00' })
    );

    await new PaymentConfigService(repo).getPaymentReadiness(OWNER);

    expect(repo.findMercadoPagoAccessToken).not.toHaveBeenCalled();
  });
});

describe('PaymentConfigService - getDepositPolicy', () => {
  it('should_return_the_stored_policy', async () => {
    const repo = makeRepository();
    vi.mocked(repo.findByOwner).mockResolvedValue(
      config({ depositType: 'FIXED', depositValue: '2000.00' })
    );

    expect(await new PaymentConfigService(repo).getDepositPolicy(OWNER)).toEqual({
      type: 'FIXED',
      value: '2000.00',
    });
  });

  it('should_report_an_unconfigured_policy_when_no_row_exists', async () => {
    const repo = makeRepository();

    expect(await new PaymentConfigService(repo).getDepositPolicy(OWNER)).toEqual({
      type: 'PERCENT',
      value: null,
    });
  });
});
