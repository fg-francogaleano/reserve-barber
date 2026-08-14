import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { MercadoPagoView } from '@/server/domain/models/PaymentConfig';

const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const getMercadoPagoView = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./paymentConfigService', () => ({
  mercadoPagoConfigService: () => ({ getMercadoPagoView }),
  credentialCipher: () => ({ encrypt: vi.fn(), decrypt: vi.fn() }),
}));
vi.mock('./actions', () => ({ saveMercadoPagoCredentialsAction: vi.fn() }));

const { default: MercadoPagoPage } = await import('./page');

function view(overrides: Partial<MercadoPagoView> = {}): MercadoPagoView {
  return {
    configured: false,
    publicKey: null,
    environment: null,
    lastFour: null,
    changedAt: null,
    unreadable: false,
    ...overrides,
  };
}

const CONFIGURED = view({
  configured: true,
  publicKey: KEY,
  lastFour: '3636',
  changedAt: new Date('2026-08-13T21:14:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  getMercadoPagoView.mockResolvedValue(view());
});

describe('MercadoPagoPage - the four states (design D12)', () => {
  it('should_render_the_unconfigured_state', async () => {
    render(await MercadoPagoPage());

    expect(screen.getByText(COPY.mercadoPago.emptyState)).toBeInTheDocument();
  });

  it('should_render_the_configured_state_without_the_token', async () => {
    getMercadoPagoView.mockResolvedValue(CONFIGURED);

    const { container } = render(await MercadoPagoPage());

    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.getByText('···3636')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  // The state this page exists to have. Without it a missing or corrupt key
  // renders a healthy-looking Configured panel over a token nobody can read,
  // and the failure surfaces for the first time in a client's checkout.
  it('should_render_the_unreadable_state_instead_of_the_configured_one', async () => {
    getMercadoPagoView.mockResolvedValue(view({ configured: true, publicKey: KEY, unreadable: true }));

    render(await MercadoPagoPage());

    expect(screen.getByText(COPY.mercadoPago.unreadableHeading)).toBeInTheDocument();
    expect(screen.getByText(COPY.mercadoPago.unreadable)).toBeInTheDocument();
    expect(screen.queryByText(COPY.mercadoPago.emptyState)).not.toBeInTheDocument();
  });

  it('should_not_confuse_unreadable_with_unconfigured', async () => {
    getMercadoPagoView.mockResolvedValue(view({ configured: true, unreadable: true }));

    render(await MercadoPagoPage());

    expect(screen.queryByText(COPY.mercadoPago.emptyState)).not.toBeInTheDocument();
  });

  it('should_render_the_test_credentials_banner_only_for_a_declared_test_credential', async () => {
    getMercadoPagoView.mockResolvedValue({ ...CONFIGURED, environment: 'test' });

    render(await MercadoPagoPage());

    expect(screen.getByText(COPY.mercadoPago.testCredentialsBanner)).toBeInTheDocument();
  });

  it('should_not_render_the_test_banner_when_the_environment_is_unknown', async () => {
    // The correction that cost design D8: `APP_USR-` says nothing, so the page
    // must stay silent rather than imply production.
    getMercadoPagoView.mockResolvedValue(CONFIGURED);

    render(await MercadoPagoPage());

    expect(screen.queryByText(COPY.mercadoPago.testCredentialsBanner)).not.toBeInTheDocument();
  });
});

describe('MercadoPagoPage - what it never claims', () => {
  // Both of these were rendered at some point and both were false. The page
  // must not regrow either.
  it('should_never_print_the_word_produccion', async () => {
    getMercadoPagoView.mockResolvedValue(CONFIGURED);

    const { container } = render(await MercadoPagoPage());

    expect(container.textContent).not.toMatch(/Producci[óo]n/i);
  });

  it('should_never_show_an_account_identifier_derived_from_the_token', async () => {
    getMercadoPagoView.mockResolvedValue(CONFIGURED);

    const { container } = render(await MercadoPagoPage());

    expect(container.textContent).not.toContain('241983636');
  });
});

describe('MercadoPagoPage - authorization and caching', () => {
  it('should_require_an_authenticated_owner', async () => {
    await MercadoPagoPage();

    expect(requireOwner).toHaveBeenCalled();
  });

  it('should_declare_itself_dynamic_on_the_page_rather_than_inheriting_it', async () => {
    // A page rendering payment configuration must not depend on an ancestor
    // layout someone edits later.
    const mod = await import('./page');

    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('should_degrade_to_an_empty_view_rather_than_crashing_when_the_read_fails', async () => {
    getMercadoPagoView.mockRejectedValue(new Error('connection lost'));

    render(await MercadoPagoPage());

    expect(screen.getByText(COPY.mercadoPago.emptyState)).toBeInTheDocument();
  });
});

describe('MercadoPagoPage - what it hands the form', () => {
  it('should_seed_the_public_key_from_the_database_not_from_submitted_state', async () => {
    getMercadoPagoView.mockResolvedValue(CONFIGURED);

    render(await MercadoPagoPage());

    expect(screen.getByLabelText(COPY.mercadoPago.publicKeyLabel)).toHaveValue(KEY);
  });

  it('should_offer_the_removal_control_only_when_credentials_are_stored', async () => {
    render(await MercadoPagoPage());
    expect(screen.queryByText(COPY.mercadoPago.remove)).not.toBeInTheDocument();

    getMercadoPagoView.mockResolvedValue(CONFIGURED);
    render(await MercadoPagoPage());
    expect(screen.getByText(COPY.mercadoPago.remove)).toBeInTheDocument();
  });
});
