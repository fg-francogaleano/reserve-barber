import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type {
  DepositPolicySettings,
  PaymentReadiness,
} from '@/server/domain/models/PaymentConfig';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const getDepositPolicy = vi.fn(
  async (): Promise<DepositPolicySettings> => ({ type: 'PERCENT', value: null })
);
const getPaymentReadiness = vi.fn(
  async (): Promise<PaymentReadiness> => ({
    ready: false,
    hasPaymentMethod: false,
    hasDepositPolicy: false,
  })
);
const credentialCipher = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./paymentConfigService', () => ({
  depositPolicyService: () => ({ getDepositPolicy, getPaymentReadiness }),
}));
vi.mock('./actions', () => ({
  saveDepositPolicyAction: vi.fn(),
  removeDepositPolicyAction: vi.fn(),
}));
// Wired so the test can assert the page never reaches for it (design D10).
vi.mock('@/server/infrastructure/crypto/WebCryptoCipher', () => ({
  WebCryptoCipher: class {
    constructor() {
      credentialCipher();
    }
  },
}));

const { default: DepositPage } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: null });
  getPaymentReadiness.mockResolvedValue({
    ready: false,
    hasPaymentMethod: false,
    hasDepositPolicy: false,
  });
});

describe('DepositPage - the stored policy', () => {
  it('should_render_an_explicit_unconfigured_state', async () => {
    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.emptyState)).toBeInTheDocument();
  });

  it('should_render_a_stored_percentage_without_the_column_decimals', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: '30.00' });

    render(await DepositPage());

    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('should_render_a_stored_fixed_amount_formatted_for_es_ar', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'FIXED', value: '8000.50' });

    render(await DepositPage());

    expect(screen.getByText('$8.000,50')).toBeInTheDocument();
  });

  it('should_name_full_prepayment_for_a_stored_one_hundred_percent', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: '100.00' });

    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.fullPrepaymentNotice)).toBeInTheDocument();
  });
});

describe('DepositPage - the readiness panel', () => {
  it('should_report_a_ready_business', async () => {
    getPaymentReadiness.mockResolvedValue({
      ready: true,
      hasPaymentMethod: true,
      hasDepositPolicy: true,
    });

    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.readinessReady)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.readinessHasPaymentMethod)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.readinessHasDeposit)).toBeInTheDocument();
  });

  it('should_name_the_missing_payment_method', async () => {
    getPaymentReadiness.mockResolvedValue({
      ready: false,
      hasPaymentMethod: false,
      hasDepositPolicy: true,
    });

    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.readinessNotReady)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.readinessMissingPaymentMethod)).toBeInTheDocument();
  });

  it('should_name_the_missing_deposit_policy', async () => {
    getPaymentReadiness.mockResolvedValue({
      ready: false,
      hasPaymentMethod: true,
      hasDepositPolicy: false,
    });

    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.readinessMissingDeposit)).toBeInTheDocument();
  });

  /** Each line carries its own words, so the answer survives a screen reader. */
  it('should_not_convey_readiness_by_colour_alone', async () => {
    getPaymentReadiness.mockResolvedValue({
      ready: false,
      hasPaymentMethod: false,
      hasDepositPolicy: false,
    });

    render(await DepositPage());

    expect(screen.getByText(COPY.deposit.readinessNotReady)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.readinessMissingPaymentMethod)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.readinessMissingDeposit)).toBeInTheDocument();
  });
});

describe('DepositPage - no redirect for a missing payment method', () => {
  /**
   * Blocking would trap an owner configuring in a different order, and would
   * contradict the transfer and Mercado Pago editors, which both permit a save
   * that leaves the business unable to take bookings (design D1).
   */
  it('should_render_the_editor_with_nothing_configured', async () => {
    render(await DepositPage());

    expect(screen.getByRole('group', { name: COPY.deposit.typeLegend })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.deposit.submit })).toBeInTheDocument();
  });
});

describe('DepositPage - independence from the credential key', () => {
  /**
   * A page about deposit amounts must not fail because of a secret belonging to
   * a different feature. Readiness comes from the presence flag the repository
   * derives without decrypting (design D10).
   */
  it('should_never_construct_the_credential_cipher', async () => {
    getPaymentReadiness.mockResolvedValue({
      ready: true,
      hasPaymentMethod: true,
      hasDepositPolicy: true,
    });

    render(await DepositPage());

    expect(credentialCipher).not.toHaveBeenCalled();
  });
});

describe('DepositPage - the form defaults', () => {
  it('should_leave_the_value_blank_when_unconfigured', async () => {
    render(await DepositPage());

    expect(screen.getByLabelText(COPY.deposit.percentLabel)).toHaveValue('');
  });

  it('should_preselect_the_stored_type', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'FIXED', value: '2000.00' });

    render(await DepositPage());

    expect(screen.getByRole('radio', { name: COPY.deposit.typeFixed })).toBeChecked();
    // Canonical, not es-AR: the field must be re-submittable unchanged, and
    // "2.000,00" would be rejected as a thousands separator on the next save.
    expect(screen.getByLabelText(COPY.deposit.fixedLabel)).toHaveValue('2000.00');
  });

  it('should_load_a_stored_percentage_into_the_field_without_the_column_decimals', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: '30.00' });

    render(await DepositPage());

    // The whole-number rule would reject "30.00" on the next save.
    expect(screen.getByLabelText(COPY.deposit.percentLabel)).toHaveValue('30');
  });

  it('should_offer_removal_only_when_a_policy_is_stored', async () => {
    render(await DepositPage());
    expect(screen.queryByRole('button', { name: COPY.deposit.remove })).not.toBeInTheDocument();

    getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: '30.00' });
    render(await DepositPage());
    expect(screen.getByRole('button', { name: COPY.deposit.remove })).toBeInTheDocument();
  });
});
