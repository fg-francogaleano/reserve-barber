import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { Barber } from '@/server/domain/models/Barber';
import { Service } from '@/server/domain/models/Service';

// ─── Hoisted mock functions (must be defined before vi.mock hoisting) ─────────

const mockGetEditorData = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    // Mirrors Next: notFound() signals by throwing, so the page must not
    // continue rendering after calling it.
    throw new Error('NEXT_NOT_FOUND');
  })
);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'test@test.com' }),
}));

vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The action module carries 'use server' and reaches for the Prisma client at
// import time — mocked so the page can be rendered in isolation.
vi.mock('./actions', () => ({
  setBarberServicesAction: vi.fn(),
}));

vi.mock('./assignmentService', () => ({
  assignmentService: () => ({ getEditorData: mockGetEditorData }),
}));

// Import AFTER mock registrations.
import BarberServicesPage from './page';

const BARBER = new Barber('barber-1', 'loc-1', 'Ana', null, true);
const CORTE = new Service('svc-corte', 'Corte', null, '4500.00', 30, true);
const RETIRED = new Service('svc-retired', 'Servicio Viejo', null, '1000.00', 15, false);

function params(id = 'barber-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => vi.clearAllMocks());

describe('BarberServicesPage — ownership', () => {
  it('should_render_not_found_for_a_barber_that_is_unknown_or_another_owners', async () => {
    // The application service returns null for both cases on purpose: a 403
    // would confirm the id exists and turn this route into an enumeration
    // oracle.
    mockGetEditorData.mockResolvedValue(null);

    await expect(BarberServicesPage(params('barber-of-someone-else'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('should_scope_the_lookup_to_the_session_owner_and_the_route_id', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      assignable: [CORTE],
      assignedIds: [],
    });

    render(await BarberServicesPage(params('barber-1')));

    expect(mockGetEditorData).toHaveBeenCalledWith('owner-1', 'barber-1');
  });
});

describe('BarberServicesPage — empty state', () => {
  it('should_explain_and_link_to_service_creation_when_the_catalogue_is_empty', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, assignable: [], assignedIds: [] });

    render(await BarberServicesPage(params()));

    expect(screen.getByText(COPY.barberServices.emptyNoServices)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: COPY.barberServices.createService })
    ).toHaveAttribute('href', '/servicios/nuevo');
  });

  it('should_not_offer_an_operable_submit_control_with_zero_options', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, assignable: [], assignedIds: [] });

    render(await BarberServicesPage(params()));

    // A submit button over an empty option set is a control that can only ever
    // do nothing.
    expect(screen.queryByRole('button', { name: COPY.barberServices.submit })).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('should_still_name_the_barber_in_the_empty_state', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, assignable: [], assignedIds: [] });

    render(await BarberServicesPage(params()));

    expect(screen.getByRole('heading', { name: COPY.barberServices.heading('Ana') })).toBeInTheDocument();
  });
});

describe('BarberServicesPage — populated editor', () => {
  it('should_render_the_form_with_the_assignable_services', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      assignable: [CORTE, RETIRED],
      assignedIds: [RETIRED.id],
    });

    render(await BarberServicesPage(params()));

    expect(screen.getByRole('checkbox', { name: /Corte/ })).toBeInTheDocument();
    // An inactive service that is already assigned stays offered and checked
    // (design D9) rather than silently disappearing from the editor.
    const retired = screen.getByRole('checkbox', { name: /Servicio Viejo/ }) as HTMLInputElement;
    expect(retired.checked).toBe(true);
    expect(screen.getByText(COPY.barberServices.inactiveMarker)).toBeInTheDocument();
  });

  it('should_explain_what_makes_a_service_bookable', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      assignable: [CORTE],
      assignedIds: [],
    });

    render(await BarberServicesPage(params()));

    expect(screen.getByText(COPY.barberServices.intro)).toBeInTheDocument();
  });
});
