import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { Service } from '@/server/domain/models/Service';

// ─── Hoisted mock functions (must be defined before vi.mock hoisting) ─────────

const mockListServices = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'test@test.com' }),
}));

vi.mock('@/server/infrastructure/prisma/client', () => ({
  getPrismaClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/server/infrastructure/prisma/PrismaServiceRepository', () => ({
  PrismaServiceRepository: vi.fn(),
}));

vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/application/services/ServiceCatalogService', () => ({
  ServiceCatalogService: vi.fn().mockImplementation(function () {
    return { listServices: mockListServices };
  }),
}));

// Import AFTER mock registrations.
import ServicesPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('ServicesPage — empty state (task 9.6)', () => {
  it('should_show_the_empty_state_and_a_working_create_call_to_action', async () => {
    mockListServices.mockResolvedValue([]);

    render(await ServicesPage());

    expect(screen.getByText(COPY.services.empty)).toBeInTheDocument();
    // Unlike barbers, a service has no upstream prerequisite, so the create
    // control is always usable and must always be offered.
    expect(screen.getByRole('link', { name: COPY.services.create })).toHaveAttribute(
      'href',
      '/servicios/nuevo'
    );
  });
});

describe('ServicesPage — rendering services', () => {
  const services = [
    new Service('svc-1', 'Corte Clásico', 'Máquina y tijera', '4500.50', 30, true),
    new Service('svc-2', 'Barba', null, '0.00', 15, true),
  ];

  it('should_render_the_price_formatted_for_es_AR', async () => {
    mockListServices.mockResolvedValue(services);

    render(await ServicesPage());

    // Formatted on the server. A trimmed ICU dataset would degrade this to
    // "ARS 4500.50" without failing anything else.
    const price = screen.getByText(/4\.500,50/);
    expect(price).toBeInTheDocument();
    expect(price.textContent).not.toContain('ARS');
  });

  it('should_render_the_duration_for_each_service', async () => {
    mockListServices.mockResolvedValue(services);

    render(await ServicesPage());

    expect(screen.getByText(COPY.services.duration(30))).toBeInTheDocument();
    expect(screen.getByText(COPY.services.duration(15))).toBeInTheDocument();
  });

  it('should_render_a_zero_price_rather_than_hiding_it', async () => {
    mockListServices.mockResolvedValue(services);

    render(await ServicesPage());

    expect(screen.getByText(/0,00/)).toBeInTheDocument();
  });

  it('should_omit_the_description_block_when_there_is_none', async () => {
    mockListServices.mockResolvedValue(services);

    const { container } = render(await ServicesPage());

    expect(screen.getByText('Máquina y tijera')).toBeInTheDocument();
    // Two services render, only one has a description: exactly one clamped
    // block may exist. An empty paragraph in the other card would leave a
    // dangling gap, and counting is the only way to catch that.
    expect(container.querySelectorAll('.line-clamp-3')).toHaveLength(1);
  });

  it('should_clamp_a_long_description_rather_than_letting_it_stretch_the_card', async () => {
    mockListServices.mockResolvedValue([
      new Service('svc-3', 'Corte', 'línea\n'.repeat(50), '1000.00', 30, true),
    ]);

    const { container } = render(await ServicesPage());

    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
  });

  it('should_clear_min_width_auto_on_both_levels_of_the_card_title', async () => {
    // Regression guard for task 10.22. A flex item defaults to min-width:auto
    // and refuses to shrink below its content's intrinsic width, so
    // `break-words` never acts and a 120-character unbroken name overflows the
    // card. Measured before the fix: 1084px of content in a 326px card.
    // jsdom does not lay out, so the guard is on the classes that produce it.
    mockListServices.mockResolvedValue([
      new Service('svc-long', 'a'.repeat(120), null, '1000.00', 30, true),
    ]);

    const { container } = render(await ServicesPage());

    const title = container.querySelector('[data-slot="card-title"]') ?? container.querySelector('.flex.min-w-0');
    expect(title?.className).toContain('min-w-0');
    expect(title?.querySelector('span')?.className).toContain('min-w-0');
    expect(title?.querySelector('span')?.className).toContain('break-words');
  });

  it('should_link_each_service_to_its_edit_page_with_an_accessible_name', async () => {
    mockListServices.mockResolvedValue(services);

    render(await ServicesPage());

    expect(
      screen.getByRole('link', { name: COPY.services.editLabel('Corte Clásico') })
    ).toHaveAttribute('href', '/servicios/svc-1/editar');
  });

  it('should_scope_the_listing_to_the_session_owner', async () => {
    mockListServices.mockResolvedValue([]);

    render(await ServicesPage());

    expect(mockListServices).toHaveBeenCalledWith('owner-1');
  });
});
