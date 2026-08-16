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

function renders(catalog = TWO_BRANCHES) {
  resolveBySlug.mockResolvedValue({ type: 'render', catalog });
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

  it('should_disclose_that_the_next_step_is_not_available_yet_once_complete', async () => {
    renders();

    render(
      await BookingPage(props({ local: 'loc-centro', servicio: 'svc-corte', barbero: 'bar-ana' }))
    );

    expect(screen.getByText(COPY.booking.continueUnavailable)).toBeInTheDocument();
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
