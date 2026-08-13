import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { PaymentConfig } from '@/server/domain/models/PaymentConfig';

const CBU = '2850590940090418135201';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const getConfig = vi.fn(async (): Promise<PaymentConfig | null> => null);

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./paymentConfigService', () => ({
  paymentConfigService: () => ({ getConfig, saveTransferDetails: vi.fn() }),
}));
vi.mock('./actions', () => ({ saveTransferDetailsAction: vi.fn() }));

const { default: TransferPage } = await import('./page');

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    id: 'cfg-1',
    ownerId: 'owner-root',
    mpPublicKey: null,
    hasMercadoPagoCredentials: false,
    transfer: { cbuCvu: CBU, alias: 'mi.barberia', holderName: 'Barberia Franco' },
    depositType: 'PERCENT',
    depositValue: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockResolvedValue(null);
});

describe('TransferPage - authentication', () => {
  it('should_resolve_the_owner_before_reading_anything', async () => {
    requireOwner.mockRejectedValueOnce(new Error('redirect to login'));

    await expect(TransferPage()).rejects.toThrow('redirect to login');

    expect(getConfig).not.toHaveBeenCalled();
  });

  it('should_scope_the_read_to_the_authenticated_owner', async () => {
    render(await TransferPage());

    expect(getConfig).toHaveBeenCalledWith('owner-root');
  });
});

describe('TransferPage - empty state', () => {
  it('should_render_the_empty_state_when_nothing_is_configured', async () => {
    render(await TransferPage());

    expect(screen.getByText(COPY.transfer.emptyState)).toBeInTheDocument();
  });

  it('should_not_warn_about_missing_payment_methods_on_a_first_visit', async () => {
    // The owner who has never configured anything has made no mistake.
    render(await TransferPage());

    expect(screen.queryByText(COPY.transfer.noMethodWarning)).not.toBeInTheDocument();
  });

  it('should_render_the_form_with_empty_fields', async () => {
    render(await TransferPage());

    expect(screen.getByLabelText(COPY.transfer.cbuLabel)).toHaveValue('');
    expect(screen.getByLabelText(COPY.transfer.holderLabel)).toHaveValue('');
  });
});

describe('TransferPage - configured state', () => {
  it('should_render_the_stored_destination_grouped_for_reading', async () => {
    getConfig.mockResolvedValue(config());

    render(await TransferPage());

    // 22 unbroken digits cannot be checked by eye, which is the one
    // verification the owner can actually perform.
    expect(screen.getAllByText('2850 5909 4009 0418 1352 01').length).toBeGreaterThan(0);
  });

  it('should_render_the_stored_alias_and_holder_name', async () => {
    getConfig.mockResolvedValue(config());

    render(await TransferPage());

    expect(screen.getByText('mi.barberia')).toBeInTheDocument();
    expect(screen.getByText('Barberia Franco')).toBeInTheDocument();
  });

  it('should_prefill_the_form_from_the_database_not_from_form_state', async () => {
    getConfig.mockResolvedValue(config());

    render(await TransferPage());

    expect(screen.getByLabelText(COPY.transfer.cbuLabel)).toHaveValue(
      '2850 5909 4009 0418 1352 01'
    );
    expect(screen.getByLabelText(COPY.transfer.aliasLabel)).toHaveValue('mi.barberia');
  });

  it('should_render_a_destination_configured_with_an_alias_only', async () => {
    getConfig.mockResolvedValue(
      config({ transfer: { cbuCvu: null, alias: 'mi.barberia', holderName: 'Barberia Franco' } })
    );

    render(await TransferPage());

    expect(screen.queryByText(COPY.transfer.emptyState)).not.toBeInTheDocument();
    expect(screen.getByText('mi.barberia')).toBeInTheDocument();
  });
});

describe('TransferPage - failure', () => {
  it('should_propagate_a_read_failure_to_the_error_boundary', async () => {
    // Rendering a payment page as if nothing were configured would be worse
    // than showing the error state.
    getConfig.mockRejectedValue(new Error('connection terminated'));

    await expect(TransferPage()).rejects.toThrow('connection terminated');
  });
});
