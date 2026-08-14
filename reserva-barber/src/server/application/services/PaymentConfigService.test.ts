import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentConfigService } from './PaymentConfigService';
import { PaymentConfigWriteConflictError } from '@/server/domain/errors/PaymentConfigErrors';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { PaymentConfig, TransferDetails } from '@/server/domain/models/PaymentConfig';

const OWNER_ID = 'owner-root';
const CBU = '2850590940090418135201';
const OTHER_CBU = '0110599520000012345678';

const DETAILS: TransferDetails = {
  cbuCvu: CBU,
  alias: 'mi.barberia',
  holderName: 'Barberia Franco',
};

const EMPTY_DETAILS: TransferDetails = { cbuCvu: null, alias: null, holderName: null };

function storedConfig(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    id: 'cfg-1',
    ownerId: OWNER_ID,
    mpPublicKey: null,
    hasMercadoPagoCredentials: false,
    transfer: DETAILS,
    depositType: 'PERCENT',
    depositValue: null,
    updatedAt: new Date('2026-08-13T12:00:00Z'),
    ...overrides,
  };
}

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
  };
}

describe('PaymentConfigService - saveTransferDetails', () => {
  let repository: IPaymentConfigRepository;
  let service: PaymentConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = makeRepository();
    service = new PaymentConfigService(repository);
  });

  it('should_write_without_confirmation_when_nothing_is_stored_yet', async () => {
    const result = await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    expect(result).toEqual({ status: 'saved', leavesNoPaymentMethod: false });
    expect(repository.upsertTransferDetails).toHaveBeenCalledWith(OWNER_ID, DETAILS);
  });

  it('should_require_confirmation_when_the_stored_destination_changes', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const changed = { ...DETAILS, cbuCvu: OTHER_CBU };
    const result = await service.saveTransferDetails(OWNER_ID, changed, { confirmed: false });

    expect(result).toEqual({ status: 'needs_confirmation', pending: changed });
    expect(repository.upsertTransferDetails).not.toHaveBeenCalled();
  });

  it('should_write_once_the_change_is_confirmed', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const changed = { ...DETAILS, cbuCvu: OTHER_CBU };
    const result = await service.saveTransferDetails(OWNER_ID, changed, { confirmed: true });

    expect(result.status).toBe('saved');
    expect(repository.upsertTransferDetails).toHaveBeenCalledWith(OWNER_ID, changed);
  });

  it('should_not_require_confirmation_when_only_the_holder_name_changed', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const renamed = { ...DETAILS, holderName: 'Barberia Franco SRL' };
    const result = await service.saveTransferDetails(OWNER_ID, renamed, { confirmed: false });

    expect(result.status).toBe('saved');
    expect(repository.upsertTransferDetails).toHaveBeenCalledWith(OWNER_ID, renamed);
  });

  it('should_not_require_confirmation_on_an_unchanged_resave', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const result = await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    expect(result.status).toBe('saved');
  });

  it('should_not_require_confirmation_when_the_row_exists_with_no_stored_destination', async () => {
    // Reachable two ways: the owner cleared the destination earlier, and later
    // when PC2 creates the row for Mercado Pago alone. Going from nothing to
    // something has no previous value to be confused with.
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ transfer: EMPTY_DETAILS })
    );

    const result = await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    expect(result.status).toBe('saved');
    expect(repository.upsertTransferDetails).toHaveBeenCalledWith(OWNER_ID, DETAILS);
  });

  it('should_not_require_confirmation_when_a_holder_name_exists_but_no_destination', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({
        transfer: { cbuCvu: null, alias: null, holderName: 'Barberia Franco' },
      })
    );

    const result = await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    expect(result.status).toBe('saved');
  });

  it('should_require_confirmation_when_clearing_a_stored_destination', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const result = await service.saveTransferDetails(OWNER_ID, EMPTY_DETAILS, { confirmed: false });

    expect(result).toEqual({ status: 'needs_confirmation', pending: EMPTY_DETAILS });
    expect(repository.upsertTransferDetails).not.toHaveBeenCalled();
  });

  it('should_warn_when_clearing_leaves_no_payment_method', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(storedConfig());

    const result = await service.saveTransferDetails(OWNER_ID, EMPTY_DETAILS, { confirmed: true });

    expect(result).toEqual({ status: 'saved', leavesNoPaymentMethod: true });
  });

  it('should_not_warn_when_mercado_pago_is_configured', async () => {
    vi.mocked(repository.findByOwner).mockResolvedValue(
      storedConfig({ hasMercadoPagoCredentials: true })
    );

    const result = await service.saveTransferDetails(OWNER_ID, EMPTY_DETAILS, { confirmed: true });

    expect(result).toEqual({ status: 'saved', leavesNoPaymentMethod: false });
  });

  it('should_never_write_a_column_belonging_to_another_payment_story', async () => {
    await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    const [, written] = vi.mocked(repository.upsertTransferDetails).mock.calls[0];
    expect(Object.keys(written).sort()).toEqual(['alias', 'cbuCvu', 'holderName']);
  });
});

describe('PaymentConfigService - concurrent creation of the singleton row', () => {
  let repository: IPaymentConfigRepository;
  let service: PaymentConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = makeRepository();
    service = new PaymentConfigService(repository);
  });

  it('should_retry_once_and_succeed_when_it_loses_the_race', async () => {
    vi.mocked(repository.upsertTransferDetails)
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(undefined);

    const result = await service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false });

    expect(result.status).toBe('saved');
    expect(repository.upsertTransferDetails).toHaveBeenCalledTimes(2);
  });

  it('should_surface_a_persistent_violation_rather_than_retrying_again', async () => {
    vi.mocked(repository.upsertTransferDetails).mockRejectedValue(uniqueViolation());

    await expect(
      service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false })
    ).rejects.toBeInstanceOf(PaymentConfigWriteConflictError);

    expect(repository.upsertTransferDetails).toHaveBeenCalledTimes(2);
  });

  it('should_not_retry_an_unrelated_failure', async () => {
    const failure = new Error('connection terminated');
    vi.mocked(repository.upsertTransferDetails).mockRejectedValue(failure);

    await expect(
      service.saveTransferDetails(OWNER_ID, DETAILS, { confirmed: false })
    ).rejects.toBe(failure);

    expect(repository.upsertTransferDetails).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentConfigService - reads', () => {
  it('should_return_null_for_an_owner_with_no_configuration', async () => {
    const repository = makeRepository();
    const service = new PaymentConfigService(repository);

    await expect(service.getConfig(OWNER_ID)).resolves.toBeNull();
  });

  it('should_read_the_public_projection_through_its_own_method', async () => {
    const repository = makeRepository();
    vi.mocked(repository.findTransferDetailsForPublic).mockResolvedValue(DETAILS);
    const service = new PaymentConfigService(repository);

    await expect(service.getTransferDetailsForPublic(OWNER_ID)).resolves.toEqual(DETAILS);
    expect(repository.findByOwner).not.toHaveBeenCalled();
  });
});
