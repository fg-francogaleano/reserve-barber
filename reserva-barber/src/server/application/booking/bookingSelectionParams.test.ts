import { describe, it, expect } from 'vitest';
import {
  resolveBookingSelection,
  withImpliedBranch,
  hasBranchChoice,
  bookingStepHref,
} from './bookingSelectionParams';
import {
  buildBookingCatalog,
  type CatalogSourceLocation,
  type PublicService,
} from '@/server/domain/models/BookingCatalog';

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

function source(
  id: string,
  name: string,
  barbers: CatalogSourceLocation['barbers']
): CatalogSourceLocation {
  return { id, name, address: null, barbers };
}

function barber(id: string, displayName: string, services: PublicService[]) {
  return { id, displayName, bio: null, avatarUrl: null, services };
}

/** Centro offers Corte and Color; Norte offers only Corte. */
const CATALOG = buildBookingCatalog([
  source('loc-centro', 'Centro', [barber('bar-ana', 'Ana', [CORTE, COLOR])]),
  source('loc-norte', 'Norte', [barber('bar-beto', 'Beto', [CORTE])]),
]);

const ONE_BRANCH = buildBookingCatalog([
  source('loc-centro', 'Centro', [barber('bar-ana', 'Ana', [CORTE])]),
]);

describe('resolveBookingSelection - which step and what survives', () => {
  it('should_render_the_location_step_when_nothing_is_selected', () => {
    const result = resolveBookingSelection(CATALOG, {});

    expect(result.step).toBe('location');
    expect(result.selection).toEqual({});
    expect(result.discarded).toEqual([]);
  });

  it('should_advance_to_the_service_step_once_a_branch_resolves', () => {
    const result = resolveBookingSelection(CATALOG, { local: 'loc-centro' });

    expect(result.step).toBe('service');
    expect(result.selection.location!.location.id).toBe('loc-centro');
    expect(result.discarded).toEqual([]);
  });

  it('should_advance_to_the_barber_step_once_a_service_resolves', () => {
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-centro',
      servicio: 'svc-corte',
    });

    expect(result.step).toBe('barber');
    expect(result.selection.service!.service.id).toBe('svc-corte');
  });

  it('should_advance_to_the_date_step_when_all_three_catalogue_selections_resolve', () => {
    // B2 reported `complete` here. B3 adds two steps after the barber, so three
    // catalogue selections no longer finish the flow — they finish the part of
    // it that a catalogue can answer.
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-centro',
      servicio: 'svc-corte',
      barbero: 'bar-ana',
    });

    expect(result.step).toBe('date');
    expect(result.selection.barber!.id).toBe('bar-ana');
    expect(result.discarded).toEqual([]);
  });
});

describe('bookingStepHref - the schedule keys are nested like the rest', () => {
  it('should_carry_a_date_and_a_time_when_everything_above_them_is_present', () => {
    const href = bookingStepHref('don-juan', {
      locationId: 'loc-centro',
      serviceId: 'svc-corte',
      barberId: 'bar-ana',
      date: '2026-08-17',
      time: '09:05',
    });

    expect(href).toBe(
      '/b/don-juan/reservar?local=loc-centro&servicio=svc-corte&barbero=bar-ana&fecha=2026-08-17&hora=09%3A05'
    );
  });

  it('should_drop_the_date_and_time_when_the_barber_is_being_changed', () => {
    // The "change barber" control passes no barberId. A link that still named a
    // date would be a selection made for a barber the client just abandoned.
    const href = bookingStepHref('don-juan', {
      locationId: 'loc-centro',
      serviceId: 'svc-corte',
      date: '2026-08-17',
      time: '09:05',
    });

    expect(href).toBe('/b/don-juan/reservar?local=loc-centro&servicio=svc-corte');
  });

  it('should_drop_the_time_when_the_date_is_being_changed', () => {
    const href = bookingStepHref('don-juan', {
      locationId: 'loc-centro',
      serviceId: 'svc-corte',
      barberId: 'bar-ana',
      time: '09:05',
    });

    expect(href).toBe('/b/don-juan/reservar?local=loc-centro&servicio=svc-corte&barbero=bar-ana');
  });

  it('should_drop_everything_downstream_when_the_branch_is_being_changed', () => {
    expect(bookingStepHref('don-juan', {})).toBe('/b/don-juan/reservar');
  });
});

describe('resolveBookingSelection - hostile and stale input', () => {
  it('should_treat_a_cross_owner_id_exactly_as_an_unknown_id', () => {
    // The whole security argument in one assertion. Neither id is in this
    // catalogue — which was built under the owner's scope — so there is no
    // branch that could tell them apart, and no oracle for "does this exist".
    const foreign = resolveBookingSelection(CATALOG, { local: 'loc-de-otra-barberia' });
    const unknown = resolveBookingSelection(CATALOG, { local: 'loc-que-no-existe' });

    expect(foreign).toEqual(unknown);
    expect(foreign.step).toBe('location');
    expect(foreign.discarded).toEqual(['location']);
  });

  it('should_reject_an_overlong_parameter_without_matching_anything', () => {
    const result = resolveBookingSelection(CATALOG, { local: 'x'.repeat(5000) });

    expect(result.step).toBe('location');
    expect(result.selection).toEqual({});
  });

  it('should_reject_an_empty_parameter', () => {
    const result = resolveBookingSelection(CATALOG, { local: '' });

    expect(result.step).toBe('location');
    // An absent value and an empty one mean the same thing: nothing chosen.
    // Neither is a discarded selection, because nothing was actually asked for.
    expect(result.discarded).toEqual([]);
  });

  it('should_resolve_a_repeated_parameter_to_its_first_value', () => {
    // Link shorteners and social networks rewrite query strings. Refusing the
    // request would turn a shared link into a dead end for an invisible reason.
    const result = resolveBookingSelection(CATALOG, {
      local: ['loc-centro', 'loc-norte'],
    });

    expect(result.step).toBe('service');
    expect(result.selection.location!.location.id).toBe('loc-centro');
  });

  it('should_discard_a_service_that_is_not_bookable_at_the_chosen_branch', () => {
    // Color exists and is bookable — at Centro. Asking for it at Norte is an
    // inconsistent triple, and the branch survives while the service does not.
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-norte',
      servicio: 'svc-color',
    });

    expect(result.step).toBe('service');
    expect(result.selection.location!.location.id).toBe('loc-norte');
    expect(result.selection.service).toBeUndefined();
    expect(result.discarded).toEqual(['service']);
  });

  it('should_discard_a_barber_who_does_not_perform_the_chosen_service_there', () => {
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-centro',
      servicio: 'svc-corte',
      barbero: 'bar-beto',
    });

    expect(result.step).toBe('barber');
    expect(result.selection.location!.location.id).toBe('loc-centro');
    expect(result.selection.service!.service.id).toBe('svc-corte');
    expect(result.discarded).toEqual(['barber']);
  });

  it('should_keep_the_upstream_selections_when_the_barber_was_deactivated', () => {
    // The ordinary WhatsApp case: the link is a week old and the barber is gone.
    // The branch and the service are both still correct and are not thrown away.
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-centro',
      servicio: 'svc-color',
      barbero: 'bar-que-ya-no-esta',
    });

    expect(result.step).toBe('barber');
    expect(result.selection.location).toBeDefined();
    expect(result.selection.service).toBeDefined();
    expect(result.discarded).toEqual(['barber']);
  });

  it('should_discard_everything_downstream_when_the_branch_does_not_resolve', () => {
    // One loss, reported once. The service and barber were chosen under a branch
    // that is no longer offered, so they cannot be consistent with whatever the
    // client picks next.
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-cerrada',
      servicio: 'svc-corte',
      barbero: 'bar-ana',
    });

    expect(result.step).toBe('location');
    expect(result.selection).toEqual({});
    expect(result.discarded).toEqual(['location']);
  });

  it('should_discard_the_barber_when_the_service_it_belonged_to_is_gone', () => {
    const result = resolveBookingSelection(CATALOG, {
      local: 'loc-norte',
      servicio: 'svc-color',
      barbero: 'bar-ana',
    });

    expect(result.step).toBe('service');
    expect(result.selection.service).toBeUndefined();
    expect(result.selection.barber).toBeUndefined();
    expect(result.discarded).toEqual(['service']);
  });

  it('should_render_the_location_step_against_an_empty_catalog', () => {
    const result = resolveBookingSelection([], { local: 'loc-centro' });

    expect(result.step).toBe('location');
    expect(result.discarded).toEqual(['location']);
  });
});

describe('withImpliedBranch - a lone branch is not a choice', () => {
  it('should_report_a_branch_choice_only_when_more_than_one_is_offerable', () => {
    expect(hasBranchChoice(CATALOG)).toBe(true);
    expect(hasBranchChoice(ONE_BRANCH)).toBe(false);
    expect(hasBranchChoice([])).toBe(false);
  });

  it('should_skip_the_branch_step_when_exactly_one_is_offerable', () => {
    const result = withImpliedBranch(ONE_BRANCH, resolveBookingSelection(ONE_BRANCH, {}));

    expect(result.step).toBe('service');
    expect(result.selection.location!.location.id).toBe('loc-centro');
  });

  it('should_not_skip_the_branch_step_when_two_are_offerable', () => {
    const result = withImpliedBranch(CATALOG, resolveBookingSelection(CATALOG, {}));

    expect(result.step).toBe('location');
    expect(result.selection.location).toBeUndefined();
  });

  it('should_not_invent_a_branch_when_the_catalog_is_empty', () => {
    const result = withImpliedBranch([], resolveBookingSelection([], {}));

    expect(result.step).toBe('location');
    expect(result.selection.location).toBeUndefined();
  });

  it('should_keep_a_discarded_notice_while_implying_the_lone_branch', () => {
    // The client asked for a branch that is gone; the shop happens to have one
    // left. They still deserve to be told their link no longer works.
    const result = withImpliedBranch(
      ONE_BRANCH,
      resolveBookingSelection(ONE_BRANCH, { local: 'loc-cerrada' })
    );

    expect(result.step).toBe('service');
    expect(result.discarded).toEqual(['location']);
  });
});
