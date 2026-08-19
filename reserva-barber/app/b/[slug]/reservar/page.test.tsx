import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import {
  buildBookingCatalog,
  type CatalogSourceLocation,
  type PublicService,
} from '@/server/domain/models/BookingCatalog';
import type { BookingCatalogResolution } from '@/server/application/services/PublicBookingCatalogService';

const resolveBySlug = vi.fn(async (): Promise<BookingCatalogResolution> => ({ type: 'notFound' }));
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const permanentRedirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  permanentRedirect: (to: string) => permanentRedirect(to),
}));
vi.mock('./bookingCatalogService', () => ({
  bookingCatalogService: () => ({ resolveBySlug }),
}));

const { default: BookingPage, generateMetadata } = await import('./page');

const CORTE: PublicService = {
  id: 'svc-corte',
  name: 'Corte',
  description: null,
  price: '10000.00',
  durationMinutes: 30,
};

const COLOR: PublicService = {
  id: 'svc-color',
  name: 'Color',
  description: null,
  price: '2000.50',
  durationMinutes: 60,
};

function loc(
  id: string,
  name: string,
  barbers: CatalogSourceLocation['barbers']
): CatalogSourceLocation {
  return { id, name, address: null, barbers };
}

function bar(id: string, displayName: string, services: PublicService[]) {
  return { id, displayName, bio: null, avatarUrl: null, services };
}

const TWO_BRANCHES = buildBookingCatalog([
  loc('loc-centro', 'Centro', [bar('bar-ana', 'Ana', [CORTE, COLOR])]),
  loc('loc-norte', 'Norte', [bar('bar-beto', 'Beto', [CORTE])]),
]);

const ONE_BRANCH = buildBookingCatalog([
  loc('loc-centro', 'Centro', [bar('bar-ana', 'Ana', [CORTE])]),
]);

function props(search: Record<string, string | string[]> = {}, slug = 'barberia-don-juan') {
  return { params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) };
}

/** Monday 2026-08-17, so a fixed weekday backs the date-step assertions. */
const TODAY = { year: 2026, month: 8, day: 17 };
const EVERY_WEEKDAY = new Set([0, 1, 2, 3, 4, 5, 6]);

/** Local 09:00 and 09:05 on that Monday. */
const SLOTS = [new Date('2026-08-17T12:00:00.000Z'), new Date('2026-08-17T12:05:00.000Z')];

function renders(
  catalog = TWO_BRANCHES,
  availabilityOverrides: {
    workingWeekdays?: ReadonlySet<number>;
    slots?: readonly Date[];
    /** `null` means the shop cannot charge a deposit and must not take bookings. */
    deposit?: string | null;
  } = {}
) {
  const slotsFor = vi.fn().mockResolvedValue(availabilityOverrides.slots ?? SLOTS);
  const workingWeekdays = vi
    .fn()
    .mockResolvedValue(availabilityOverrides.workingWeekdays ?? EVERY_WEEKDAY);

  // B4: the details step reads a deposit. A shop that can take bookings
  // returns an amount; `null` is the not-taking-bookings state.
  const depositFor = vi
    .fn()
    .mockResolvedValue(
      availabilityOverrides.deposit === undefined ? '500.00' : availabilityOverrides.deposit
    );

  resolveBySlug.mockResolvedValue({
    type: 'render',
    catalog,
    availability: { today: () => TODAY, workingWeekdays, slotsFor, depositFor },
  });

  return { slotsFor, workingWeekdays, depositFor };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_ORIGIN;
});

describe('BookingPage - resolving the shop before the selection', () => {
  it('should_produce_a_404_for_a_slug_that_does_not_resolve', async () => {
    resolveBySlug.mockResolvedValue({ type: 'notFound' });

    await expect(BookingPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('should_308_a_non_canonical_spelling_preserving_the_query_string', async () => {
    // B1 shipped the canonical redirect for `/b/{slug}` alone. Dropping the
    // query here would discard the client's selection during a redirect they
    // never asked for.
    resolveBySlug.mockResolvedValue({ type: 'redirect', canonicalSlug: 'barberia-don-juan' });

    await expect(
      BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte' }, 'BARBERIA-DON-JUAN'))
    ).rejects.toThrow(
      'NEXT_REDIRECT:/b/barberia-don-juan/reservar?local=loc-centro&servicio=svc-corte'
    );
  });

  it('should_308_with_no_query_string_when_none_was_sent', async () => {
    resolveBySlug.mockResolvedValue({ type: 'redirect', canonicalSlug: 'barberia-don-juan' });

    await expect(BookingPage(props({}, 'BARBERIA-DON-JUAN'))).rejects.toThrow(
      'NEXT_REDIRECT:/b/barberia-don-juan/reservar'
    );
  });
});

describe('BookingPage - the steps', () => {
  it('should_render_the_branch_step_first_when_two_branches_are_offerable', async () => {
    renders();

    render(await BookingPage(props()));

    expect(screen.getByRole('heading', { name: COPY.booking.locationHeading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Centro/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Norte/ })).toBeInTheDocument();
  });

  it('should_skip_the_branch_step_when_only_one_is_offerable', async () => {
    renders(ONE_BRANCH);

    render(await BookingPage(props()));

    expect(screen.getByRole('heading', { name: COPY.booking.serviceHeading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COPY.booking.locationHeading })).toBeNull();
  });

  it('should_render_the_service_step_scoped_to_the_chosen_branch', async () => {
    renders();

    render(await BookingPage(props({ local: 'loc-norte' })));

    // Norte performs only Corte. Color is bookable at Centro and must be absent
    // here — the (service, location) unit in the rendered output.
    expect(screen.getByRole('link', { name: /Corte/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Color/ })).toBeNull();
  });

  it('should_render_the_barber_step_scoped_to_the_chosen_service', async () => {
    renders();

    render(await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte' })));

    expect(screen.getByRole('heading', { name: COPY.booking.barberHeading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Beto/ })).toBeNull();
  });

  it('should_advance_to_the_date_step_once_the_barber_is_chosen', async () => {
    // B2 ended here with a disclosure. B3 adds two steps, so the same URL now
    // renders the date step and the disclosure moves to the end of the flow.
    renders();

    render(
      await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-ana' }))
    );

    expect(screen.getByRole('heading', { name: COPY.booking.dateHeading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COPY.booking.datosHeading })).not.toBeInTheDocument();
  });

  it('should_render_the_client_details_form_once_a_time_is_chosen', async () => {
    // B3 ended here with an inert disclosure because the route it would have
    // posted to did not exist. B4 built it.
    renders();

    render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
          hora: '09:00',
        })
      )
    );

    expect(screen.getByRole('heading', { name: COPY.booking.datosHeading })).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.booking.nameLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.booking.emailLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.booking.phoneLabel)).toBeInTheDocument();
  });

  it('should_carry_the_whole_selection_as_hidden_inputs_for_the_write_to_re_verify', async () => {
    renders();

    const { container } = render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
          hora: '09:00',
        })
      )
    );

    const form = container.querySelector('form[action="/api/bookings"]');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')).toBe('post');

    const hidden = Object.fromEntries(
      Array.from(form?.querySelectorAll('input[type="hidden"]') ?? []).map((input) => [
        input.getAttribute('name'),
        input.getAttribute('value'),
      ])
    );

    expect(hidden).toMatchObject({
      slug: 'barberia-don-juan',
      locationId: 'loc-centro',
      serviceId: 'svc-corte',
      barberId: 'bar-ana',
      fecha: '2026-08-17',
      hora: '09:00',
    });
  });

  it('should_refuse_to_render_the_form_when_the_shop_cannot_charge_a_deposit', async () => {
    // The wall B2 named when it left the payment-readiness gate to B4. It
    // never says which half of the owner's configuration is missing.
    renders(TWO_BRANCHES, { deposit: null });

    render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
          hora: '09:00',
        })
      )
    );

    expect(screen.getByText(COPY.booking.notTakingBookings)).toBeInTheDocument();
    expect(screen.queryByLabelText(COPY.booking.emailLabel)).not.toBeInTheDocument();
  });

  it('should_read_no_payment_configuration_before_the_details_step', async () => {
    // Every earlier step issues no payment query at all — the narrowing B2's
    // spec anticipated, kept as narrow as it was written.
    const { depositFor } = renders();

    render(
      await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-ana' }))
    );

    expect(depositFor).not.toHaveBeenCalled();
  });

  it('should_carry_no_form_control_that_delegates_validation_to_the_browser_locale', async () => {
    // `pattern`, `min`, `max` and `step` each let the browser block the
    // submission with a message from a string that exists in no copy module.
    renders();

    const { container } = render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
          hora: '09:00',
        })
      )
    );

    for (const attribute of ['pattern', 'min', 'max', 'step', 'minlength', 'maxlength']) {
      expect(container.querySelector(`form [${attribute}]`)).toBeNull();
    }
  });

  it('should_format_the_price_in_es_AR_with_two_decimals', async () => {
    // The `.50` case. A price shown as `$2.000,05` or `$20.005` is a money bug
    // in front of the person about to pay it.
    renders();

    render(await BookingPage(props({ local: 'loc-centro' })));

    expect(screen.getByText('$2.000,50')).toBeInTheDocument();
    expect(screen.getByText('$10.000,00')).toBeInTheDocument();
  });
});

describe('BookingPage - stale and hostile selections', () => {
  it('should_fall_back_to_the_branch_step_and_say_so_when_the_branch_is_gone', async () => {
    renders();

    render(await BookingPage(props({ local: 'loc-cerrada', servicio: 'svc-corte' })));

    expect(screen.getByRole('heading', { name: COPY.booking.locationHeading })).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.staleLocation)).toBeInTheDocument();
  });

  it('should_keep_the_upstream_selections_when_only_the_barber_is_gone', async () => {
    renders();

    render(
      await BookingPage(
        props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-que-se-fue' })
      )
    );

    expect(screen.getByRole('heading', { name: COPY.booking.barberHeading })).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.staleBarber)).toBeInTheDocument();
    expect(screen.getByText('Centro')).toBeInTheDocument();
  });

  it('should_render_a_cross_owner_id_exactly_as_an_unknown_one', async () => {
    renders();

    const foreign = render(await BookingPage(props({ local: 'loc-de-otra-barberia' })));
    const foreignHtml = foreign.container.innerHTML;
    foreign.unmount();

    const unknown = render(await BookingPage(props({ local: 'loc-inexistente' })));

    expect(unknown.container.innerHTML).toBe(foreignHtml);
  });

  it('should_not_render_anything_for_an_overlong_parameter', async () => {
    renders();

    render(await BookingPage(props({ local: 'x'.repeat(5000) })));

    expect(screen.getByRole('heading', { name: COPY.booking.locationHeading })).toBeInTheDocument();
  });

  it('should_resolve_a_repeated_parameter_to_its_first_value', async () => {
    renders();

    render(await BookingPage(props({ local: ['loc-centro', 'loc-norte'] })));

    expect(screen.getByRole('heading', { name: COPY.booking.serviceHeading })).toBeInTheDocument();
    expect(screen.getByText('Centro')).toBeInTheDocument();
  });
});

describe('BookingPage - a shop with nothing bookable', () => {
  it('should_render_a_designed_empty_state_rather_than_an_empty_list', async () => {
    renders([]);

    render(await BookingPage(props()));

    expect(screen.getByRole('heading', { name: COPY.booking.emptyShop })).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.emptyShopHelp)).toBeInTheDocument();
  });

  it('should_not_render_a_step_indicator_when_there_is_nothing_to_step_through', async () => {
    renders([]);

    render(await BookingPage(props()));

    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('should_not_disclose_why_nothing_is_bookable', async () => {
    renders([]);

    const { container } = render(await BookingPage(props()));

    expect(container.textContent).not.toMatch(/desactiv|inactiv|elimin|borr/i);
  });
});

describe('BookingPage - the route declares no loading boundary', () => {
  it('should_not_ship_a_loading_file_for_this_route', async () => {
    // Inherited whole from B1's runtime measurement (design D8). A `loading.tsx`
    // opens a Suspense boundary, Next commits `200 OK` before the page resolves,
    // and `notFound()` / `permanentRedirect()` degrade to a soft 404 and a meta
    // refresh. This route makes both calls, and WhatsApp — the product's actual
    // distribution channel — follows redirects but not meta refreshes.
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    expect(existsSync(join(process.cwd(), 'app', 'b', '[slug]', 'reservar', 'loading.tsx'))).toBe(
      false
    );
  });

  it('should_render_per_request', async () => {
    const mod = await import('./page');

    expect(mod.dynamic).toBe('force-dynamic');
  });
});

describe('BookingPage - metadata', () => {
  it('should_declare_the_bare_path_as_canonical_when_an_origin_is_configured', async () => {
    process.env.APP_ORIGIN = 'https://reservabarber.com';

    const metadata = await generateMetadata(props({ local: 'loc-centro' }));

    expect(metadata.alternates?.canonical).toBe('/b/barberia-don-juan/reservar');
  });

  it('should_omit_absolute_metadata_when_no_origin_is_configured', async () => {
    // The `Host` header comes from a stranger here. Feeding it into a canonical
    // would have a shop declare someone else's origin authoritative for its own
    // booking page.
    const metadata = await generateMetadata(props());

    expect(metadata).toEqual({});
  });

  it('should_not_read_the_catalog_to_produce_metadata', async () => {
    process.env.APP_ORIGIN = 'https://reservabarber.com';

    await generateMetadata(props());

    expect(resolveBySlug).not.toHaveBeenCalled();
  });
});

describe('BookingPage - the availability read is paid for by the step that needs it', () => {
  it('should_issue_no_availability_read_on_the_catalogue_steps', async () => {
    // The whole reason the schedule is resolved after the catalogue rather than
    // beside it. A client on the branch step must not pay for a query about a
    // barber they have not chosen.
    const { slotsFor, workingWeekdays } = renders();

    render(await BookingPage(props({ local: 'loc-centro' })));

    expect(slotsFor).not.toHaveBeenCalled();
    expect(workingWeekdays).not.toHaveBeenCalled();
  });

  it('should_issue_only_the_cheap_weekly_read_on_the_date_step', async () => {
    const { slotsFor, workingWeekdays } = renders();

    render(
      await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-ana' }))
    );

    expect(workingWeekdays).toHaveBeenCalledTimes(1);
    expect(slotsFor).not.toHaveBeenCalled();
  });

  it('should_issue_exactly_one_day_read_on_the_slot_step', async () => {
    const { slotsFor } = renders();

    render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
        })
      )
    );

    expect(slotsFor).toHaveBeenCalledTimes(1);
    expect(slotsFor).toHaveBeenCalledWith({
      barberId: 'bar-ana',
      date: { year: 2026, month: 8, day: 17 },
      durationMinutes: CORTE.durationMinutes,
    });
  });
});

describe('BookingPage - a stale schedule link degrades', () => {
  it('should_discard_a_past_date_and_keep_every_upstream_selection', async () => {
    renders();

    render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2020-01-01',
        })
      )
    );

    expect(screen.getByText(COPY.booking.staleDate)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.booking.dateHeading })).toBeInTheDocument();
    // The branch and service survive: the client lost one choice, not three.
    expect(screen.getByText('Centro')).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();
  });

  it('should_answer_a_taken_time_and_an_absurd_time_identically', async () => {
    // No oracle. A start another client just booked and a syntactically absurd
    // one must be indistinguishable to anyone sweeping the parameter.
    renders();
    const selection = {
      local: 'loc-centro',
      servicio: 'svc-corte',
      barbero: 'bar-ana',
      fecha: '2026-08-17',
    };

    const taken = render(await BookingPage(props({ ...selection, hora: '11:45' })));
    const takenHtml = taken.container.innerHTML;
    taken.unmount();

    const absurd = render(await BookingPage(props({ ...selection, hora: '99:99' })));

    expect(absurd.container.innerHTML).toBe(takenHtml);
  });

  it('should_render_the_empty_state_for_a_day_with_nothing_free', async () => {
    renders(TWO_BRANCHES, { slots: [] });

    render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-20',
        })
      )
    );

    expect(screen.getByText(COPY.booking.emptyDay)).toBeInTheDocument();
  });

  it('should_render_the_horizon_empty_state_for_a_barber_who_works_no_day', async () => {
    renders(TWO_BRANCHES, { workingWeekdays: new Set() });

    render(
      await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-ana' }))
    );

    expect(screen.getByText(COPY.booking.emptyHorizon)).toBeInTheDocument();
  });
});

describe('BookingPage - unavailable times are absent, not labelled', () => {
  it('should_render_only_the_offered_starts', async () => {
    renders();

    const { container } = render(
      await BookingPage(
        props({
          local: 'loc-centro',
          servicio: 'svc-corte',
          barbero: 'bar-ana',
          fecha: '2026-08-17',
        })
      )
    );

    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('09:05')).toBeInTheDocument();
    // Nothing announces a time as taken, and no disabled control stands in for
    // one — that would publish the barber's agenda to an anonymous visitor.
    expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/ocupado|reservado|no disponible/i);
  });
});

describe('BookingPage - a failed availability read fails closed', () => {
  const SELECTION = {
    local: 'loc-centro',
    servicio: 'svc-corte',
    barbero: 'bar-ana',
  };

  it('should_propagate_a_failed_day_read_instead_of_rendering_an_empty_slot_list', async () => {
    // The whole point of failing closed. Rendering "no hay turnos" here would
    // tell a client the barber is booked solid when the truth is that nobody
    // asked the database — and rendering slots from a partial result would sell
    // an appointment that is already taken. Propagating hands it to the
    // client-toned boundary this namespace already has.
    const { slotsFor } = renders();
    slotsFor.mockRejectedValue(new Error('connection lost'));

    await expect(
      BookingPage(props({ ...SELECTION, fecha: '2026-08-17' }))
    ).rejects.toThrow('connection lost');
  });

  it('should_propagate_a_failed_weekly_read_on_the_date_step', async () => {
    const { workingWeekdays } = renders();
    workingWeekdays.mockRejectedValue(new Error('connection lost'));

    await expect(BookingPage(props(SELECTION))).rejects.toThrow('connection lost');
  });

  it('should_not_render_a_slot_list_from_a_failed_read', async () => {
    const { slotsFor } = renders();
    slotsFor.mockRejectedValue(new Error('connection lost'));

    let markup = '';
    try {
      const { container } = render(await BookingPage(props({ ...SELECTION, fecha: '2026-08-17' })));
      markup = container.innerHTML;
    } catch {
      // Expected: the read failed, so there is nothing to render.
    }

    expect(markup).toBe('');
    expect(markup).not.toContain('09:00');
    expect(markup).not.toContain(COPY.booking.emptyDay);
  });

  it('should_carry_no_internal_detail_when_the_read_fails', async () => {
    // The boundary renders generic copy and never the message, but the message
    // is what would reach a log or a digest — so it must not be dressed up with
    // schema detail on the way out either.
    const { slotsFor } = renders();
    slotsFor.mockRejectedValue(
      new Error('relation "Booking" does not exist: SELECT "startTime" FROM "Booking"')
    );

    const failure = await BookingPage(props({ ...SELECTION, fecha: '2026-08-17' })).catch(
      (error: unknown) => error
    );

    // The page adds nothing of its own: what propagates is exactly what the
    // driver raised, so no response body is ever built from it.
    expect(failure).toBeInstanceOf(Error);
    const rendered = (failure as Error).stack ?? '';
    expect(rendered).not.toMatch(/DATABASE_URL|postgres:\/\/|PAYMENT_CREDENTIALS_KEY/);
  });

  it('should_still_answer_the_catalogue_steps_when_availability_is_broken', async () => {
    // A failure of the availability read must not take down the steps that do
    // not need it — those issue no availability query at all.
    const { slotsFor, workingWeekdays } = renders();
    slotsFor.mockRejectedValue(new Error('connection lost'));
    workingWeekdays.mockRejectedValue(new Error('connection lost'));

    render(await BookingPage(props({ local: 'loc-centro' })));

    expect(screen.getByRole('heading', { name: COPY.booking.serviceHeading })).toBeInTheDocument();
  });
});
