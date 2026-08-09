import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';

// ─── Hoisted mock functions (must be defined before vi.mock hoisting) ─────────

const mockListBarbers = vi.hoisted(() => vi.fn());
const mockListOwnerLocations = vi.hoisted(() => vi.fn());

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

vi.mock('@/server/application/services/BarberService', () => ({
  BarberService: vi.fn().mockImplementation(function () {
    return { listBarbers: mockListBarbers };
  }),
}));

vi.mock('@/server/application/services/LocationService', () => ({
  LocationService: vi.fn().mockImplementation(function () {
    return { listOwnerLocations: mockListOwnerLocations };
  }),
}));

// Import AFTER mock registrations.
import BarbersPage from './page';

beforeEach(() => vi.clearAllMocks());

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
