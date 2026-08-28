import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { ClientDirectoryView } from '@/server/application/services/ClientDirectoryService';
import type { ClientDirectoryRow } from '@/server/domain/repositories/IClientDirectoryRepository';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const loadPage = vi.fn();
const loggerError = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./clientDirectoryService', () => ({
  clientDirectoryService: () => ({ loadPage }),
}));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));

const { default: ClientsPage } = await import('./page');

function client(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    id: 'cli-1',
    name: 'Ana Pérez',
    email: 'ana@example.com',
    phone: '+5491133334444',
    confirmedCount: 3,
    inactiveCount: 0,
    ...overrides,
  };
}

function view(overrides: Partial<ClientDirectoryView> = {}): ClientDirectoryView {
  return {
    rows: [client()],
    page: 1,
    lastPage: 1,
    total: 1,
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await ClientsPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  loadPage.mockResolvedValue(view());
});

describe('ClientsPage - the guard and the read', () => {
  it('should_resolve_the_owner_before_reading_anything', async () => {
    await renderPage();

    expect(requireOwner).toHaveBeenCalled();
    expect(loadPage).toHaveBeenCalledWith({ ownerId: 'owner-root', rawPage: undefined });
  });

  it('should_pass_the_page_parameter_through_unparsed', async () => {
    // The page decides nothing about the value; the resolver does.
    await renderPage({ pagina: '3' });

    expect(loadPage).toHaveBeenCalledWith({ ownerId: 'owner-root', rawPage: '3' });
  });
});

describe('ClientsPage - the table', () => {
  it('should_render_a_client_with_contact_details_and_counts', async () => {
    await renderPage();

    expect(screen.getAllByText('Ana Pérez').length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY.clients.confirmedCount(3)).length).toBeGreaterThan(0);
  });

  it('should_offer_the_telephone_as_a_call_link', async () => {
    await renderPage();

    const [link] = screen.getAllByRole('link', { name: COPY.clients.callLabel('Ana Pérez') });
    expect(link).toHaveAttribute('href', 'tel:+5491133334444');
  });

  it('should_offer_the_email_as_a_mail_link', async () => {
    await renderPage();

    const [link] = screen.getAllByRole('link', { name: COPY.clients.emailLabel('Ana Pérez') });
    expect(link).toHaveAttribute('href', 'mailto:ana@example.com');
  });

  it('should_associate_every_column_header_with_its_column', async () => {
    await renderPage();

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    for (const header of headers) expect(header).toHaveAttribute('scope', 'col');
  });

  it('should_render_the_same_client_as_a_block_for_small_screens', async () => {
    // Four columns of contact data do not fit a phone.
    await renderPage();

    const blocks = screen.getByRole('list');
    expect(within(blocks).getByText('Ana Pérez')).toBeInTheDocument();
  });
});

describe('ClientsPage - what the counts are allowed to say', () => {
  it('should_show_only_the_confirmed_count_when_nothing_was_cancelled', async () => {
    await renderPage();

    expect(screen.queryByText(COPY.clients.inactiveCount(1))).not.toBeInTheDocument();
  });

  it('should_add_the_secondary_count_when_something_was_cancelled', async () => {
    loadPage.mockResolvedValue(view({ rows: [client({ confirmedCount: 2, inactiveCount: 3 })] }));

    await renderPage();

    expect(screen.getAllByText(COPY.clients.inactiveCount(3)).length).toBeGreaterThan(0);
  });

  it('should_tell_a_serial_canceller_apart_from_somebody_who_never_booked', async () => {
    // Both read zero on the headline figure, and they are opposite facts.
    loadPage.mockResolvedValue(
      view({
        rows: [
          client({ id: 'canceller', name: 'Canceló', confirmedCount: 0, inactiveCount: 3 }),
          client({ id: 'ghost', name: 'Nunca', confirmedCount: 0, inactiveCount: 0 }),
        ],
        total: 2,
      })
    );

    await renderPage();

    expect(screen.getAllByText(COPY.clients.inactiveCount(3)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY.clients.noBookings).length).toBeGreaterThan(0);
  });

  it('should_not_call_a_client_with_no_bookings_a_customer', async () => {
    // The booking flow creates the client row before it writes the booking, so
    // a refused submission leaves one behind. "0 turnos cumplidos" would report
    // a failed checkout as business.
    loadPage.mockResolvedValue(
      view({ rows: [client({ confirmedCount: 0, inactiveCount: 0 })] })
    );

    await renderPage();

    expect(screen.getAllByText(COPY.clients.noBookings).length).toBeGreaterThan(0);
    expect(screen.queryByText(COPY.clients.confirmedCount(0))).not.toBeInTheDocument();
  });
});

describe('ClientsPage - paging', () => {
  it('should_show_no_page_links_when_everything_fits', async () => {
    await renderPage();

    expect(screen.queryByRole('link', { name: COPY.clients.nextPage })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.clients.totalStatus(1))).toBeInTheDocument();
  });

  it('should_offer_the_next_page_but_not_a_previous_one_on_the_first', async () => {
    loadPage.mockResolvedValue(view({ page: 1, lastPage: 3, total: 60 }));

    await renderPage();

    expect(screen.getByRole('link', { name: COPY.clients.nextPage })).toHaveAttribute(
      'href',
      '/clientes?pagina=2'
    );
    expect(screen.queryByRole('link', { name: COPY.clients.previousPage })).not.toBeInTheDocument();
  });

  it('should_link_back_to_the_unparameterised_url_from_the_second_page', async () => {
    loadPage.mockResolvedValue(view({ page: 2, lastPage: 3, total: 60 }));

    await renderPage();

    expect(screen.getByRole('link', { name: COPY.clients.previousPage })).toHaveAttribute(
      'href',
      '/clientes'
    );
  });

  it('should_state_where_in_the_list_the_owner_is', async () => {
    loadPage.mockResolvedValue(view({ page: 2, lastPage: 3, total: 60 }));

    await renderPage();

    expect(screen.getByText(/Página 2 de 3/)).toBeInTheDocument();
  });
});

describe('ClientsPage - empty and failed states', () => {
  it('should_say_nobody_has_booked_yet_and_offer_the_public_profile', async () => {
    loadPage.mockResolvedValue(view({ rows: [], total: 0, page: 1, lastPage: 1 }));

    await renderPage();

    expect(screen.getByText(COPY.clients.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.clients.emptyLink })).toHaveAttribute(
      'href',
      '/perfil'
    );
  });

  it('should_report_a_failed_read_inside_the_page', async () => {
    loadPage.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.getByText(COPY.clients.loadFailed)).toBeInTheDocument();
  });

  it('should_not_claim_an_empty_customer_base_when_the_read_failed', async () => {
    // Zero and failure never render alike: an empty table here would be a
    // false statement about the owner's business.
    loadPage.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.queryByText(COPY.clients.empty)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('should_log_a_failure_without_any_contact_detail_or_parameter', async () => {
    loadPage.mockRejectedValue(new Error('pool exhausted'));

    await renderPage({ pagina: '3' });

    const serialized = JSON.stringify(loggerError.mock.calls);
    expect(serialized).toContain('loadClients');
    for (const forbidden of ['ana@example.com', '+5491133334444', 'Ana Pérez', '"3"']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('should_log_no_key_beyond_the_shared_helpers_own', async () => {
    // **The shape, not today's values.** Asserting that three strings are
    // absent passes for any context, including one this page enriched with a
    // client row later. The helper's keys are the contract: `operation`, and
    // `code`/`cause` when the driver supplies them. Anything else on this page
    // is a widening that has to be argued for.
    loadPage.mockRejectedValue(new Error('pool exhausted'));

    await renderPage({ pagina: '3' });

    const context = loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(['cause', 'operation']);
    expect(context.operation).toBe('loadClients');
  });
});

describe('ClientsPage - layout at the awkward case', () => {
  it('should_allow_a_maximum_length_name_to_wrap', async () => {
    const name = 'a'.repeat(120);
    loadPage.mockResolvedValue(view({ rows: [client({ name })] }));

    await renderPage();

    for (const node of screen.getAllByText(name)) {
      expect(node.className).toMatch(/break-words/);
    }
  });

  it('should_allow_a_long_email_to_break_anywhere', async () => {
    // An address has no spaces to wrap at, so `break-words` is not enough.
    const email = `${'a'.repeat(200)}@example.com`;
    loadPage.mockResolvedValue(view({ rows: [client({ email })] }));

    await renderPage();

    for (const link of screen.getAllByText(email)) {
      expect(link.closest('[class*="break-all"]')).not.toBeNull();
    }
  });
});
