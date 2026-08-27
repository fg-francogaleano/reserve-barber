import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { composeCalendarDay, type CalendarAppointment } from '@/server/domain/models/barberCalendarDay';
import type { BarberCalendarView } from '@/server/application/services/BarberCalendarService';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const dayFor = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./barberCalendarService', () => ({
  barberCalendarService: () => ({ dayFor, today: () => TODAY }),
}));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

const { default: BarberCalendarPage } = await import('./page');

/** Tuesday 8 September 2026. Local hour `h` is `h + 3` UTC (UTC−3, no DST). */
const TODAY: LocalDate = { year: 2026, month: 9, day: 8 };

function at(localHour: number, localMinute = 0): Date {
  return new Date(Date.UTC(2026, 8, 8, localHour + 3, localMinute));
}

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'bk-1',
    startTime: at(11),
    endTime: at(11, 30),
    status: 'CONFIRMED',
    holdExpiresAt: null,
    clientName: 'Ana Pérez',
    serviceName: 'Corte',
    cancelledBy: null,
    ...overrides,
  };
}

function view(input: {
  windows?: readonly { startMinute: number; endMinute: number }[];
  absences?: readonly { start: Date; end: Date }[];
  appointments?: readonly CalendarAppointment[];
  date?: LocalDate;
}): BarberCalendarView {
  return {
    barber: { id: 'bar-nico', displayName: 'Nico', locationName: 'Centro' },
    date: input.date ?? TODAY,
    today: TODAY,
    day: composeCalendarDay({
      date: input.date ?? TODAY,
      windows: input.windows ?? [{ startMinute: 9 * 60, endMinute: 18 * 60 }],
      absences: input.absences ?? [],
      appointments: input.appointments ?? [],
      now: at(10),
    }),
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(
    await BarberCalendarPage({
      params: Promise.resolve({ id: 'bar-nico' }),
      searchParams: Promise.resolve(searchParams),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dayFor.mockResolvedValue(view({}));
});

describe('BarberCalendarPage - the guard and the oracle', () => {
  it('should_resolve_the_owner_before_reading_anything', async () => {
    await renderPage();

    expect(requireOwner).toHaveBeenCalled();
    expect(dayFor).toHaveBeenCalledWith(
      expect.objectContaining({ barberId: 'bar-nico', ownerId: 'owner-root' })
    );
  });

  it('should_answer_not_found_for_a_barber_outside_this_owners_scope', async () => {
    // Unknown and foreign are the same answer: a 403 would confirm the id
    // exists and turn this route into an enumeration oracle.
    dayFor.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('should_not_answer_not_found_when_the_read_failed', async () => {
    // `notFound()` signals by throwing. Called inside the catch, a 404 would
    // render as a failure message for a barber that does not exist.
    dayFor.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('BarberCalendarPage - the day', () => {
  it('should_name_the_barber_and_the_location', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nico');
    expect(screen.getByText('Centro')).toBeInTheDocument();
  });

  it('should_render_an_appointment_with_its_time_client_and_service', async () => {
    dayFor.mockResolvedValue(view({ appointments: [appointment()] }));

    await renderPage();

    expect(screen.getByText('11:00 a 11:30')).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();
  });

  it('should_state_the_presence_in_text_rather_than_by_colour_alone', async () => {
    dayFor.mockResolvedValue(
      view({ appointments: [appointment({ status: 'PENDING_APPROVAL' })] })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.presence.awaitingApproval)).toBeInTheDocument();
  });

  it('should_render_free_time_around_an_appointment', async () => {
    dayFor.mockResolvedValue(view({ appointments: [appointment()] }));

    await renderPage();

    expect(screen.getByText('09:00 a 11:00')).toBeInTheDocument();
    expect(screen.getByText('11:30 a 18:00')).toBeInTheDocument();
  });

  it('should_render_an_absence_without_its_reason', async () => {
    dayFor.mockResolvedValue(view({ absences: [{ start: at(13), end: at(14) }] }));

    await renderPage();

    expect(screen.getByText(/Ausencia/)).toBeInTheDocument();
  });

  it('should_offer_day_navigation_that_is_never_prefetched', async () => {
    await renderPage();

    const previous = screen.getByRole('link', { name: COPY.barberCalendar.previousDay });
    expect(previous).toHaveAttribute('href', '/barberos/bar-nico/calendario?fecha=2026-09-07');
  });

  it('should_read_the_day_from_the_url_and_degrade_a_malformed_one', async () => {
    await renderPage({ fecha: 'no-es-una-fecha' });

    expect(dayFor).toHaveBeenCalledWith(expect.objectContaining({ date: TODAY }));
  });

  it('should_read_a_valid_day_from_the_url', async () => {
    await renderPage({ fecha: '2026-09-10' });

    expect(dayFor).toHaveBeenCalledWith(
      expect.objectContaining({ date: { year: 2026, month: 9, day: 10 } })
    );
  });

  it('should_mark_a_past_day', async () => {
    const past = { year: 2026, month: 9, day: 1 };
    dayFor.mockResolvedValue(view({ date: past }));

    await renderPage({ fecha: '2026-09-01' });

    expect(screen.getByText(COPY.barberCalendar.pastDay)).toBeInTheDocument();
  });

  it('should_not_mark_today_as_past', async () => {
    await renderPage();

    expect(screen.queryByText(COPY.barberCalendar.pastDay)).not.toBeInTheDocument();
  });
});

describe('BarberCalendarPage - the two lanes', () => {
  it('should_keep_a_cancelled_booking_out_of_the_timeline', async () => {
    dayFor.mockResolvedValue(
      view({
        appointments: [
          appointment({ id: 'gone', status: 'CANCELLED', clientName: 'Cancelada' }),
          appointment({ id: 'kept', clientName: 'Vigente' }),
        ],
      })
    );

    await renderPage();

    const timeline = screen.getByRole('list', { name: COPY.barberCalendar.appointmentsHeading });
    expect(timeline).toHaveTextContent('Vigente');
    // The cancelled one is present on the page, inside the disclosure.
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText(COPY.barberCalendar.recordedHeading(1))).toBeInTheDocument();
  });

  it('should_count_the_recorded_entries', async () => {
    dayFor.mockResolvedValue(
      view({
        appointments: [
          appointment({ id: 'a', status: 'CANCELLED' }),
          appointment({ id: 'b', status: 'EXPIRED' }),
        ],
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.recordedHeading(2))).toBeInTheDocument();
  });

  it('should_name_who_cancelled_when_the_row_records_it', async () => {
    dayFor.mockResolvedValue(
      view({
        appointments: [appointment({ status: 'CANCELLED', cancelledBy: 'CLIENT' })],
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.cancelledByClient)).toBeInTheDocument();
  });

  it('should_not_invent_an_actor_for_a_cancellation_that_records_none', async () => {
    dayFor.mockResolvedValue(
      view({ appointments: [appointment({ status: 'CANCELLED', cancelledBy: null })] })
    );

    await renderPage();

    expect(screen.queryByText(COPY.barberCalendar.cancelledByOwner)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.cancelledByClient)).not.toBeInTheDocument();
  });

  it('should_show_a_lapsed_hold_as_recorded_and_leave_its_time_free', async () => {
    dayFor.mockResolvedValue(
      view({
        appointments: [
          appointment({ status: 'PENDING_PAYMENT', holdExpiresAt: at(9, 30) }),
        ],
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.recordedHeading(1))).toBeInTheDocument();
    expect(screen.getByText('09:00 a 18:00')).toBeInTheDocument();
  });
});

describe('BarberCalendarPage - the stranded badge', () => {
  it('should_badge_an_appointment_left_outside_a_narrowed_schedule', async () => {
    dayFor.mockResolvedValue(
      view({
        windows: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
        appointments: [appointment({ startTime: at(17, 30), endTime: at(18) })],
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.outsideHours)).toBeInTheDocument();
    expect(screen.getByText(COPY.barberCalendar.outsideHoursHint)).toBeInTheDocument();
  });

  it('should_not_badge_an_appointment_inside_the_schedule', async () => {
    dayFor.mockResolvedValue(view({ appointments: [appointment()] }));

    await renderPage();

    expect(screen.queryByText(COPY.barberCalendar.outsideHours)).not.toBeInTheDocument();
  });

  it('should_render_an_appointment_on_a_day_with_no_schedule_at_all', async () => {
    // Nothing to sit inside, and it must still be shown: this is the most
    // severe form of the stranded condition, not a reason to drop the row.
    dayFor.mockResolvedValue(view({ windows: [], appointments: [appointment()] }));

    await renderPage();

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText(COPY.barberCalendar.outsideHours)).toBeInTheDocument();
  });
});

describe('BarberCalendarPage - empty and failed states', () => {
  it('should_say_the_barber_does_not_work_that_day', async () => {
    dayFor.mockResolvedValue(view({ windows: [] }));

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.noSchedule)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: COPY.barberCalendar.manageSchedule })
    ).toHaveAttribute('href', '/barberos/bar-nico/horarios');
  });

  it('should_say_the_day_is_open_and_empty_without_reusing_the_no_schedule_copy', async () => {
    // Two opposite facts. One shared empty state would send the owner to fix a
    // schedule that is not broken.
    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.emptyDay)).toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.noSchedule)).not.toBeInTheDocument();
  });

  it('should_report_a_failed_read_inside_the_page', async () => {
    dayFor.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.loadFailed)).toBeInTheDocument();
  });

  it('should_render_no_day_content_when_the_read_failed', async () => {
    // Zero and failure never render alike: an empty day would be a false
    // statement about the barber's schedule.
    dayFor.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.queryByText(COPY.barberCalendar.emptyDay)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.freeHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.noSchedule)).not.toBeInTheDocument();
  });

  it('should_keep_the_day_navigation_available_after_a_failure', async () => {
    dayFor.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.getByRole('link', { name: COPY.barberCalendar.today })).toBeInTheDocument();
  });

  it('should_not_render_an_empty_barber_name_after_a_failure', async () => {
    dayFor.mockRejectedValue(new Error('pool exhausted'));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      COPY.barberCalendar.headingUnknown
    );
  });
});

describe('BarberCalendarPage - layout at the awkward case', () => {
  it('should_allow_a_long_unbroken_client_name_to_wrap', async () => {
    // T18: the defect this project has already shipped once, on the card grid
    // this page is opened from.
    const name = 'a'.repeat(120);
    dayFor.mockResolvedValue(view({ appointments: [appointment({ clientName: name })] }));

    await renderPage();

    expect(screen.getByText(name)).toHaveClass('break-words');
  });
});

describe('BarberCalendarPage - what an absence is allowed to claim', () => {
  it('should_render_a_same_day_absence_as_a_range', async () => {
    dayFor.mockResolvedValue(view({ absences: [{ start: at(13), end: at(14) }] }));

    await renderPage();

    expect(screen.getByText(/13:00 a 14:00/)).toBeInTheDocument();
  });

  it('should_call_a_multi_day_absence_a_whole_day_rather_than_a_range', async () => {
    // Rendered from its two instants, this said "10:00 a 18:00" — eight hours
    // on a day the barber is away for all of.
    dayFor.mockResolvedValue(
      view({
        absences: [
          { start: new Date(Date.UTC(2026, 8, 7, 13)), end: new Date(Date.UTC(2026, 8, 9, 21)) },
        ],
      })
    );

    await renderPage();

    expect(screen.getByText(/Todo el día/)).toBeInTheDocument();
    expect(screen.queryByText(/10:00 a 18:00/)).not.toBeInTheDocument();
  });

  it('should_say_when_an_absence_that_began_earlier_lifts', async () => {
    dayFor.mockResolvedValue(
      view({ absences: [{ start: new Date(Date.UTC(2026, 8, 7, 13)), end: at(12) }] })
    );

    await renderPage();

    expect(screen.getByText(/Hasta las 12:00/)).toBeInTheDocument();
  });

  it('should_say_when_an_absence_that_continues_afterwards_starts', async () => {
    dayFor.mockResolvedValue(
      view({ absences: [{ start: at(15), end: new Date(Date.UTC(2026, 8, 10, 13)) }] })
    );

    await renderPage();

    expect(screen.getByText(/Desde las 15:00/)).toBeInTheDocument();
  });
});

describe('BarberCalendarPage - the empty day tells the truth about absences', () => {
  it('should_say_the_schedule_is_free_end_to_end_when_nothing_touches_the_day', async () => {
    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.emptyDayHint)).toBeInTheDocument();
  });

  it('should_say_the_barber_is_away_when_an_absence_covers_the_whole_day', async () => {
    // Found at runtime, not here: "sin turnos / el horario está libre de punta
    // a punta" sat directly above "sin tiempo libre en este día". Each sentence
    // was correct; together they contradicted each other.
    dayFor.mockResolvedValue(
      view({
        absences: [
          { start: new Date(Date.UTC(2026, 8, 7, 13)), end: new Date(Date.UTC(2026, 8, 9, 21)) },
        ],
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.emptyDayAway)).toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.emptyDayHint)).not.toBeInTheDocument();
  });

  it('should_claim_nothing_when_an_absence_only_dents_the_day', async () => {
    // No short sentence is both true and useful here, and the free-time chips
    // below already state exactly what is left.
    dayFor.mockResolvedValue(view({ absences: [{ start: at(13), end: at(14) }] }));

    await renderPage();

    expect(screen.getByText(COPY.barberCalendar.emptyDay)).toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.emptyDayHint)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.barberCalendar.emptyDayAway)).not.toBeInTheDocument();
  });
});
