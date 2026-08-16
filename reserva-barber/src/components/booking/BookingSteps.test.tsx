import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { LocationStep } from './LocationStep';
import { ServiceStep } from './ServiceStep';
import { BarberStep } from './BarberStep';
import { BookingStepIndicator } from './BookingStepIndicator';
import { BookingSelectionSummary } from './BookingSelectionSummary';
import {
  buildBookingCatalog,
  findLocation,
  findService,
  type CatalogSourceLocation,
  type PublicService,
} from '@/server/domain/models/BookingCatalog';

const CORTE: PublicService = {
  id: 'svc-corte',
  name: 'Corte',
  description: 'Corte clásico con máquina y tijera',
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
  barbers: CatalogSourceLocation['barbers'],
  address: string | null = null
): CatalogSourceLocation {
  return { id, name, address, barbers };
}

function bar(
  id: string,
  displayName: string,
  services: PublicService[],
  extra: { bio?: string | null; avatarUrl?: string | null } = {}
) {
  return {
    id,
    displayName,
    bio: extra.bio ?? null,
    avatarUrl: extra.avatarUrl ?? null,
    services,
  };
}

const CATALOG = buildBookingCatalog([
  loc('loc-centro', 'Centro', [bar('bar-ana', 'Ana', [CORTE, COLOR])], 'Av. Siempreviva 742'),
  loc('loc-norte', 'Norte', [bar('bar-beto', 'Beto', [CORTE])]),
]);

const CENTRO = findLocation(CATALOG, 'loc-centro')!;

describe('LocationStep', () => {
  it('should_link_each_offerable_branch_to_its_service_step', () => {
    render(<LocationStep slug="barberia-don-juan" catalog={CATALOG} />);

    expect(screen.getByRole('link', { name: /Centro/ })).toHaveAttribute(
      'href',
      '/b/barberia-don-juan/reservar?local=loc-centro'
    );
  });

  it('should_render_the_address_when_present_and_omit_it_otherwise', () => {
    render(<LocationStep slug="barberia-don-juan" catalog={CATALOG} />);

    expect(screen.getByText('Av. Siempreviva 742')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Norte/ }).textContent).toBe('Norte');
  });

  it('should_render_the_shop_empty_state_for_an_empty_catalog', () => {
    render(<LocationStep slug="barberia-don-juan" catalog={[]} />);

    expect(screen.getByRole('heading', { name: COPY.booking.emptyShop })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ServiceStep', () => {
  it('should_offer_only_the_services_bookable_at_that_branch', () => {
    const norte = findLocation(CATALOG, 'loc-norte')!;

    render(<ServiceStep slug="barberia-don-juan" location={norte} hasBranchChoice />);

    expect(screen.getByRole('link', { name: /Corte/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Color/ })).toBeNull();
  });

  it('should_carry_the_branch_into_the_service_link', () => {
    render(<ServiceStep slug="barberia-don-juan" location={CENTRO} hasBranchChoice />);

    expect(screen.getByRole('link', { name: /Corte/ })).toHaveAttribute(
      'href',
      '/b/barberia-don-juan/reservar?local=loc-centro&servicio=svc-corte'
    );
  });

  it('should_format_a_fifty_centavo_price_correctly', () => {
    render(<ServiceStep slug="barberia-don-juan" location={CENTRO} hasBranchChoice />);

    expect(screen.getByText('$2.000,50')).toBeInTheDocument();
  });

  it('should_show_the_duration_alongside_the_price', () => {
    render(<ServiceStep slug="barberia-don-juan" location={CENTRO} hasBranchChoice />);

    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
  });

  it('should_omit_the_description_when_absent', () => {
    render(<ServiceStep slug="barberia-don-juan" location={CENTRO} hasBranchChoice />);

    expect(screen.getByText('Corte clásico con máquina y tijera')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Color/ }).textContent).not.toContain('null');
  });

  it('should_not_offer_a_route_back_to_a_branch_step_that_does_not_exist', () => {
    const empty = { location: CENTRO.location, services: [] };

    render(<ServiceStep slug="barberia-don-juan" location={empty} hasBranchChoice={false} />);

    expect(screen.getByRole('heading', { name: COPY.booking.emptyServices })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('BarberStep', () => {
  it('should_offer_only_barbers_who_perform_that_service_there', () => {
    const corte = findService(CENTRO, 'svc-corte')!;

    render(<BarberStep slug="barberia-don-juan" location={CENTRO} service={corte} />);

    expect(screen.getByRole('link', { name: /Ana/ })).toHaveAttribute(
      'href',
      '/b/barberia-don-juan/reservar?local=loc-centro&servicio=svc-corte&barbero=bar-ana'
    );
    expect(screen.queryByRole('link', { name: /Beto/ })).toBeNull();
  });

  it('should_render_an_initials_placeholder_when_a_barber_has_no_avatar', () => {
    const corte = findService(CENTRO, 'svc-corte')!;

    const { container } = render(
      <BarberStep slug="barberia-don-juan" location={CENTRO} service={corte} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('should_render_an_avatar_through_a_plain_img_with_reserved_space', () => {
    const withAvatar = buildBookingCatalog([
      loc('loc-centro', 'Centro', [
        bar('bar-ana', 'Ana', [CORTE], { avatarUrl: 'https://storage.example/ana.webp' }),
      ]),
    ]);
    const centro = findLocation(withAvatar, 'loc-centro')!;

    const { container } = render(
      <BarberStep
        slug="barberia-don-juan"
        location={centro}
        service={findService(centro, 'svc-corte')!}
      />
    );

    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://storage.example/ana.webp');
    expect(img).toHaveAttribute('width', '48');
    expect(img).toHaveAttribute('height', '48');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('should_render_its_own_empty_state_when_the_last_assignment_is_gone', () => {
    const empty = { service: CORTE, barbers: [] };

    render(<BarberStep slug="barberia-don-juan" location={CENTRO} service={empty} />);

    expect(screen.getByRole('heading', { name: COPY.booking.emptyBarbers })).toBeInTheDocument();
  });
});

describe('BookingStepIndicator', () => {
  it('should_mark_the_current_step_programmatically_not_by_styling_alone', () => {
    render(<BookingStepIndicator current="service" hasBranchChoice />);

    expect(screen.getByText(COPY.booking.steps.service)).toHaveAttribute('aria-current', 'step');
  });

  it('should_drop_the_branch_step_from_the_count_when_it_is_not_a_choice', () => {
    render(<BookingStepIndicator current="service" hasBranchChoice={false} />);

    expect(screen.queryByText(COPY.booking.steps.location)).toBeNull();
    expect(screen.getByText(COPY.booking.stepPosition(1, 2))).toBeInTheDocument();
  });

  it('should_keep_the_last_step_marked_once_the_selection_is_complete', () => {
    render(<BookingStepIndicator current="complete" hasBranchChoice />);

    expect(screen.getByText(COPY.booking.steps.barber)).toHaveAttribute('aria-current', 'step');
  });
});

describe('BookingSelectionSummary', () => {
  it('should_render_nothing_before_a_branch_is_chosen', () => {
    const { container } = render(
      <BookingSelectionSummary slug="barberia-don-juan" selection={{}} hasBranchChoice />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should_name_a_lone_branch_without_offering_to_change_it', () => {
    render(
      <BookingSelectionSummary
        slug="barberia-don-juan"
        selection={{ location: CENTRO }}
        hasBranchChoice={false}
      />
    );

    expect(screen.getByText('Centro')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COPY.booking.change })).toBeNull();
  });

  it('should_drop_the_downstream_selection_from_a_change_link', () => {
    // Changing the service must not produce a link that still names the barber
    // chosen under it — the resolver would discard it and the client would be
    // told about a loss they did not cause.
    render(
      <BookingSelectionSummary
        slug="barberia-don-juan"
        selection={{ location: CENTRO, service: findService(CENTRO, 'svc-corte')! }}
        hasBranchChoice
      />
    );

    const [changeBranch, changeService] = screen.getAllByRole('link', {
      name: COPY.booking.change,
    });
    expect(changeBranch).toHaveAttribute('href', '/b/barberia-don-juan/reservar');
    expect(changeService).toHaveAttribute('href', '/b/barberia-don-juan/reservar?local=loc-centro');
  });
});
