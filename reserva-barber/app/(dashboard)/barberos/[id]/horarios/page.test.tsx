import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { Barber } from '@/server/domain/models/Barber';
import { WorkingHours } from '@/server/domain/models/WorkingHours';

const mockGetEditorData = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    // Mirrors Next: notFound() signals by throwing, so the page must not carry
    // on rendering after calling it.
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
// `actions.ts` carries 'use server' and reaches for the Prisma client at import
// time — mocked so the page can be rendered in isolation.
vi.mock('./actions', () => ({ setWorkingHoursAction: vi.fn() }));
vi.mock('./scheduleService', () => ({
  scheduleService: () => ({ getEditorData: mockGetEditorData }),
}));

import WorkingHoursPage from './page';

const BARBER = new Barber('barber-1', 'loc-1', 'Ana', null, true);

function params(id = 'barber-1') {
  return { params: Promise.resolve({ id }) };
}

function field(day: number, which: 'start' | 'end'): HTMLInputElement {
  const label = which === 'start' ? COPY.workingHours.startLabel : COPY.workingHours.endLabel;
  return screen.getByLabelText(
    `${COPY.workingHours.dayNames[day]} — ${label}`
  ) as HTMLInputElement;
}

beforeEach(() => vi.clearAllMocks());

describe('WorkingHoursPage — ownership', () => {
  it('should_render_not_found_for_an_unknown_or_foreign_barber', async () => {
    // Both cases return null on purpose: a distinguishable response would
    // confirm the id exists and turn this route into an enumeration oracle.
    mockGetEditorData.mockResolvedValue(null);

    await expect(WorkingHoursPage(params('barber-of-someone-else'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('should_scope_the_lookup_to_the_session_owner_and_the_route_id', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, windows: [] });

    render(await WorkingHoursPage(params('barber-1')));

    expect(mockGetEditorData).toHaveBeenCalledWith('owner-1', 'barber-1');
  });
});

describe('WorkingHoursPage — the stored week reaches the form', () => {
  it('should_prefill_the_days_that_have_a_window', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      windows: [new WorkingHours('wh-1', 1, 540, 1080), new WorkingHours('wh-2', 6, 630, 840)],
    });

    render(await WorkingHoursPage(params()));

    expect(field(1, 'start').value).toBe('09:00');
    expect(field(1, 'end').value).toBe('18:00');
    expect(field(6, 'start').value).toBe('10:30');
  });

  it('should_leave_days_without_a_window_empty', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      windows: [new WorkingHours('wh-1', 1, 540, 1080)],
    });

    render(await WorkingHoursPage(params()));

    // Empty is the absence of a working day, not a missing value.
    expect(field(0, 'start').value).toBe('');
    expect(field(3, 'end').value).toBe('');
  });

  it('should_apply_no_offset_when_formatting_the_stored_minutes', async () => {
    mockGetEditorData.mockResolvedValue({
      barber: BARBER,
      windows: [new WorkingHours('wh-1', 2, 465, 795)],
    });

    render(await WorkingHoursPage(params()));

    // 465 is 07:45 wall clock. An offset leak would render 04:45 or 10:45.
    expect(field(2, 'start').value).toBe('07:45');
    expect(field(2, 'end').value).toBe('13:15');
  });

  it('should_name_the_barber_in_the_heading', async () => {
    mockGetEditorData.mockResolvedValue({ barber: BARBER, windows: [] });

    render(await WorkingHoursPage(params()));

    expect(
      screen.getByRole('heading', { name: COPY.workingHours.heading('Ana') })
    ).toBeInTheDocument();
  });
});
