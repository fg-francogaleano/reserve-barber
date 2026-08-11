import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { Barber } from '@/server/domain/models/Barber';
import { TimeOff } from '@/server/domain/models/TimeOff';

const mockGetEditorData = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
);

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'test@test.com' }),
}));
vi.mock('@/server/infrastructure/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('next/navigation', () => ({ notFound: () => mockNotFound() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./actions', () => ({
  recordAbsenceAction: vi.fn(),
  removeAbsenceAction: vi.fn(),
}));
vi.mock('./timeOffService', () => ({
  timeOffService: () => ({ getEditorData: mockGetEditorData }),
}));

import TimeOffPage from './page';

const BARBER = new Barber('barber-1', 'loc-1', 'Ana', null, true);

function params(id = 'barber-1') {
  return { params: Promise.resolve({ id }) };
}

/** A whole day: local midnight to the next local midnight. */
const WHOLE_DAY = new TimeOff(
  'to-1',
  new Date('2026-08-11T03:00:00.000Z'),
  new Date('2026-08-12T03:00:00.000Z'),
  null
);

beforeEach(() => vi.clearAllMocks());

describe('TimeOffPage — ownership', () => {
  it('should_render_not_found_for_an_unknown_or_foreign_barber', async () => {
    mockGetEditorData.mockResolvedValue(null);

    await expect(TimeOffPage(params('barber-of-someone-else'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('should_scope_the_lookup_to_the_session_owner_and_the_route_id', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, absences: [] });

    render(await TimeOffPage(params('barber-1')));

    expect(mockGetEditorData).toHaveBeenCalledWith('owner-1', 'barber-1');
  });
});

describe('TimeOffPage — the list', () => {
  it('should_show_an_empty_state_rather_than_a_bare_heading', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, absences: [] });

    render(await TimeOffPage(params()));

    expect(screen.getByText(COPY.timeOff.empty)).toBeInTheDocument();
  });

  it('should_render_a_whole_day_absence_by_its_last_covered_day', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, absences: [WHOLE_DAY] });

    render(await TimeOffPage(params()));

    // Stored end is the 12th at 00:00, but the barber is away on the 11th.
    // Showing the 12th would claim an absence that does not exist.
    expect(screen.getByText('11/08/2026')).toBeInTheDocument();
    expect(screen.queryByText(/12\/08\/2026/)).toBeNull();
  });

  it('should_show_the_reason_when_there_is_one', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      absences: [
        new TimeOff('to-2', WHOLE_DAY.startsAt, WHOLE_DAY.endsAt, 'Vacaciones'),
      ],
    });

    render(await TimeOffPage(params()));

    expect(screen.getByText('Vacaciones')).toBeInTheDocument();
  });

  it('should_offer_a_removal_control_naming_the_absence', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, absences: [WHOLE_DAY] });

    render(await TimeOffPage(params()));

    expect(
      screen.getByRole('button', { name: COPY.timeOff.removeLabel('11/08/2026') })
    ).toBeInTheDocument();
  });

  it('should_name_the_barber_in_the_heading', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, absences: [] });

    render(await TimeOffPage(params()));

    expect(
      screen.getByRole('heading', { name: COPY.timeOff.heading('Ana') })
    ).toBeInTheDocument();
  });
});
