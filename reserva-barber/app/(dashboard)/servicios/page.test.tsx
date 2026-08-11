import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { Service } from '@/server/domain/models/Service';

// ─── Hoisted mock functions (must be defined before vi.mock hoisting) ─────────

const mockListServices = vi.hoisted(() => vi.fn());
const mockCountActiveBarbersByService = vi.hoisted(() => vi.fn());

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

vi.mock('@/server/infrastructure/prisma/PrismaBarberServiceRepository', () => ({
  PrismaBarberServiceRepository: vi.fn().mockImplementation(function () {
    return { countActiveBarbersByService: mockCountActiveBarbersByService };
  }),
}));

// Import AFTER mock registrations.
import ServicesPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  // Default for the tests that predate assignments: nothing is assigned, so
  // they exercise the not-bookable branch unless they say otherwise.
  mockCountActiveBarbersByService.mockResolvedValue(new Map<string, number>());
});

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

// ─── M4 — bookability is a three-term conjunction ────────────────────────────

describe('ServicesPage — bookability marker', () => {
  const active = new Service('svc-1', 'Corte', null, '4500.00', 30, true);
  const inactive = new Service('svc-2', 'Servicio Viejo', null, '1000.00', 15, false);

  it('should_mark_a_service_with_no_assigned_barber', async () => {
    mockListServices.mockResolvedValue([active]);
    mockCountActiveBarbersByService.mockResolvedValue(new Map<string, number>());

    render(await ServicesPage());

    expect(screen.getByText(COPY.services.notBookableBadge)).toBeInTheDocument();
    expect(screen.getByText(COPY.services.notBookableHint)).toBeInTheDocument();
  });

  it('should_mark_a_service_assigned_only_to_inactive_barbers', async () => {
    mockListServices.mockResolvedValue([active]);
    // The count excludes inactive barbers, so "assigned but all inactive"
    // arrives here as zero.
    mockCountActiveBarbersByService.mockResolvedValue(new Map([['svc-1', 0]]));

    render(await ServicesPage());

    expect(screen.getByText(COPY.services.notBookableBadge)).toBeInTheDocument();
  });

  it('should_mark_an_inactive_service_even_when_an_active_barber_performs_it', async () => {
    mockListServices.mockResolvedValue([inactive]);
    mockCountActiveBarbersByService.mockResolvedValue(new Map([['svc-2', 2]]));

    render(await ServicesPage());

    // Without the isActive term this service would read as bookable — the
    // defect the original M3 wording would have shipped once M6 lands.
    expect(screen.getByText(COPY.services.notBookableBadge)).toBeInTheDocument();
  });

  it('should_not_mark_an_active_service_with_an_active_assigned_barber', async () => {
    mockListServices.mockResolvedValue([active]);
    mockCountActiveBarbersByService.mockResolvedValue(new Map([['svc-1', 1]]));

    render(await ServicesPage());

    expect(screen.queryByText(COPY.services.notBookableBadge)).toBeNull();
  });

  it('should_convey_the_marker_by_text_not_by_colour_alone', async () => {
    mockListServices.mockResolvedValue([active]);
    mockCountActiveBarbersByService.mockResolvedValue(new Map<string, number>());

    render(await ServicesPage());

    // Exposed as a status so assistive technology reads it as part of the
    // service, rather than skipping it as decoration.
    expect(screen.getByRole('status')).toHaveTextContent(COPY.services.notBookableBadge);
  });
});

describe('ServicesPage — a closed branch suppresses bookability', () => {
  const active = new Service('svc-1', 'Corte', null, '4500.00', 30, true);

  it('should_mark_a_service_whose_only_barbers_work_at_a_closed_branch', async () => {
    mockListServices.mockResolvedValue([active]);
    // The repository excludes barbers at inactive locations, so "assigned only
    // at a closed branch" arrives here as zero — the booking flow selects a
    // location first, so no client could ever reach that service.
    mockCountActiveBarbersByService.mockResolvedValue(new Map([['svc-1', 0]]));

    render(await ServicesPage());

    expect(screen.getByText(COPY.services.notBookableBadge)).toBeInTheDocument();
  });

  it('should_clear_the_marker_when_one_open_branch_remains', async () => {
    mockListServices.mockResolvedValue([active]);
    // Two assigned barbers, one at a closed branch: the count sees only the
    // reachable one, and one is enough.
    mockCountActiveBarbersByService.mockResolvedValue(new Map([['svc-1', 1]]));

    render(await ServicesPage());

    expect(screen.queryByText(COPY.services.notBookableBadge)).toBeNull();
  });
});
