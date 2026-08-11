import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';

// ─── Hoisted mock functions (must be defined before vi.mock hoisting) ─────────

const mockListBarbers = vi.hoisted(() => vi.fn());
const mockListOwnerLocations = vi.hoisted(() => vi.fn());
const mockCountServicesByBarber = vi.hoisted(() => vi.fn());
const mockFindBarberIdsWithSchedule = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'test@test.com' }),
}));

vi.mock('@/server/infrastructure/prisma/client', () => ({
  getPrismaClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/server/infrastructure/prisma/PrismaBarberRepository', () => ({
  PrismaBarberRepository: vi.fn(),
}));

vi.mock('@/server/infrastructure/prisma/PrismaLocationRepository', () => ({
  PrismaLocationRepository: vi.fn(),
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

vi.mock('@/server/application/services/BarberCatalogService', () => ({
  BarberCatalogService: vi.fn().mockImplementation(function () {
    return { listBarbers: mockListBarbers };
  }),
}));

vi.mock('@/server/application/services/LocationService', () => ({
  LocationService: vi.fn().mockImplementation(function () {
    return { listOwnerLocations: mockListOwnerLocations };
  }),
}));

vi.mock('@/server/infrastructure/prisma/PrismaBarberServiceRepository', () => ({
  PrismaBarberServiceRepository: vi.fn().mockImplementation(function () {
    return { countServicesByBarber: mockCountServicesByBarber };
  }),
}));

vi.mock('@/server/infrastructure/prisma/PrismaWorkingHoursRepository', () => ({
  PrismaWorkingHoursRepository: vi.fn().mockImplementation(function () {
    return { findBarberIdsWithSchedule: mockFindBarberIdsWithSchedule };
  }),
}));

// Import AFTER mock registrations.
import BarbersPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  // Default for the tests that predate assignments: no barber has any.
  mockCountServicesByBarber.mockResolvedValue(new Map<string, number>());
  mockFindBarberIdsWithSchedule.mockResolvedValue(new Set<string>());
});

// ─── 9.6 — Empty state branches on location presence ──────────────────────────

describe('BarbersPage — empty state branching (task 9.6)', () => {
  it('should_show_the_no_locations_message_and_no_create_link_when_owner_has_no_locations', async () => {
    mockListBarbers.mockResolvedValue([]);
    mockListOwnerLocations.mockResolvedValue([]);

    const jsx = await BarbersPage();
    render(jsx);

    expect(screen.getByText(COPY.barbers.emptyNoLocations)).toBeInTheDocument();
    // The create link must not appear — it would lead to an unusable empty form.
    expect(screen.queryByRole('link', { name: COPY.barbers.create })).toBeNull();
  });

  it('should_show_the_empty_barberos_message_and_the_create_link_when_locations_exist', async () => {
    mockListBarbers.mockResolvedValue([]);
    mockListOwnerLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Sucursal Centro', isActive: true, ownerId: 'owner-1', address: null },
    ]);

    const jsx = await BarbersPage();
    render(jsx);

    expect(screen.getByText(COPY.barbers.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.barbers.create })).toBeInTheDocument();
  });

  it('should_not_show_either_empty_message_when_barbers_exist', async () => {
    mockListBarbers.mockResolvedValue([
      {
        barber: {
          id: 'barber-1',
          locationId: 'loc-1',
          displayName: 'Juan Pérez',
          bio: null,
          isActive: true,
        },
        locationName: 'Sucursal Centro',
        locationIsActive: true,
      },
    ]);
    mockListOwnerLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Sucursal Centro', isActive: true, ownerId: 'owner-1', address: null },
    ]);

    const jsx = await BarbersPage();
    render(jsx);

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.queryByText(COPY.barbers.empty)).toBeNull();
    expect(screen.queryByText(COPY.barbers.emptyNoLocations)).toBeNull();
  });
});

// ─── M4 — assigned-service count and the route into the editor ───────────────

describe('BarbersPage — assigned services', () => {
  const barberRow = (id: string, displayName: string) => ({
    barber: { id, locationId: 'loc-1', displayName, bio: null, isActive: true },
    locationName: 'Sucursal Centro',
    locationIsActive: true,
  });

  beforeEach(() => {
    mockListOwnerLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Sucursal Centro', isActive: true, ownerId: 'owner-1', address: null },
    ]);
  });

  it('should_show_the_assigned_service_count_for_each_barber', async () => {
    mockListBarbers.mockResolvedValue([barberRow('barber-1', 'Ana'), barberRow('barber-2', 'Luis')]);
    mockCountServicesByBarber.mockResolvedValue(
      new Map([
        ['barber-1', 3],
        ['barber-2', 1],
      ])
    );

    render(await BarbersPage());

    expect(screen.getByText(COPY.barberServices.assignedCount(3))).toBeInTheDocument();
    expect(screen.getByText(COPY.barberServices.assignedCount(1))).toBeInTheDocument();
  });

  it('should_show_zero_rather_than_omitting_the_indicator', async () => {
    mockListBarbers.mockResolvedValue([barberRow('barber-1', 'Ana')]);
    mockCountServicesByBarber.mockResolvedValue(new Map<string, number>());

    render(await BarbersPage());

    // A barber assigned to nothing cannot be booked for anything — that is
    // exactly the state the list has to make visible.
    expect(screen.getByText(COPY.barberServices.assignedCount(0))).toBeInTheDocument();
  });

  it('should_link_to_the_assignment_editor_with_an_accessible_name', async () => {
    mockListBarbers.mockResolvedValue([barberRow('barber-1', 'Ana')]);

    render(await BarbersPage());

    expect(
      screen.getByRole('link', { name: COPY.barberServices.manageLabel('Ana') })
    ).toHaveAttribute('href', '/barberos/barber-1/servicios');
  });
});

// ─── M5a — schedule indicator and the route into the editor ──────────────────

describe('BarbersPage — working hours indicator', () => {
  const row = (id: string, displayName: string) => ({
    barber: { id, locationId: 'loc-1', displayName, bio: null, isActive: true },
    locationName: 'Sucursal Centro',
    locationIsActive: true,
  });

  beforeEach(() => {
    mockListOwnerLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Sucursal Centro', isActive: true, ownerId: 'owner-1', address: null },
    ]);
  });

  it('should_flag_a_barber_with_no_schedule_and_say_why_it_matters', async () => {
    mockListBarbers.mockResolvedValue([row('barber-1', 'Ana')]);
    mockFindBarberIdsWithSchedule.mockResolvedValue(new Set<string>());

    render(await BarbersPage());

    expect(screen.getByText(COPY.workingHours.noSchedule)).toBeInTheDocument();
    expect(screen.getByText(COPY.workingHours.noScheduleHint)).toBeInTheDocument();
  });

  it('should_show_the_positive_state_too_rather_than_only_the_negative', async () => {
    mockListBarbers.mockResolvedValue([row('barber-1', 'Ana')]);
    mockFindBarberIdsWithSchedule.mockResolvedValue(new Set(['barber-1']));

    render(await BarbersPage());

    expect(screen.getByText(COPY.workingHours.hasSchedule)).toBeInTheDocument();
    expect(screen.queryByText(COPY.workingHours.noSchedule)).toBeNull();
  });

  it('should_distinguish_barbers_within_the_same_list', async () => {
    mockListBarbers.mockResolvedValue([row('barber-1', 'Ana'), row('barber-2', 'Luis')]);
    mockFindBarberIdsWithSchedule.mockResolvedValue(new Set(['barber-1']));

    render(await BarbersPage());

    expect(screen.getByText(COPY.workingHours.hasSchedule)).toBeInTheDocument();
    expect(screen.getByText(COPY.workingHours.noSchedule)).toBeInTheDocument();
  });

  it('should_link_to_the_schedule_editor_with_an_accessible_name', async () => {
    mockListBarbers.mockResolvedValue([row('barber-1', 'Ana')]);

    render(await BarbersPage());

    expect(
      screen.getByRole('link', { name: COPY.workingHours.manageLabel('Ana') })
    ).toHaveAttribute('href', '/barberos/barber-1/horarios');
  });
});

// ─── M5b — route into the absences editor ────────────────────────────────────

describe('BarbersPage — absences route', () => {
  it('should_link_to_the_absences_editor_with_an_accessible_name', async () => {
    mockListBarbers.mockResolvedValue([
      {
        barber: { id: 'barber-1', locationId: 'loc-1', displayName: 'Ana', bio: null, isActive: true },
        locationName: 'Sucursal Centro',
        locationIsActive: true,
      },
    ]);
    mockListOwnerLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Sucursal Centro', isActive: true, ownerId: 'owner-1', address: null },
    ]);

    render(await BarbersPage());

    expect(screen.getByRole('link', { name: COPY.timeOff.manageLabel('Ana') })).toHaveAttribute(
      'href',
      '/barberos/barber-1/ausencias'
    );
  });
});
