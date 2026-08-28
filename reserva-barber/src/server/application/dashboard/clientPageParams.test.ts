import { describe, it, expect } from 'vitest';
import {
  CLIENTS_PAGE_PARAM,
  CLIENTS_PAGE_SIZE,
  MAX_CLIENTS_PAGE,
  clampToLastPage,
  clientPageHref,
  lastPageFor,
  resolveRequestedPage,
  skipFor,
} from './clientPageParams';

describe('clientPageParams - the requested page', () => {
  it('should_default_to_the_first_page_when_nothing_is_submitted', () => {
    expect(resolveRequestedPage(undefined)).toBe(1);
  });

  it('should_accept_a_page', () => {
    expect(resolveRequestedPage('3')).toBe(3);
  });

  it.each([
    ['a word', 'tres'],
    ['an empty value', ''],
    ['a decimal', '2.5'],
    ['a negative', '-4'],
    ['zero', '0'],
    ['a leading plus', '+2'],
    ['whitespace', ' 2 '],
    ['a number with a suffix', '2x'],
  ])('should_degrade_to_the_first_page_when_given_%s', (_label, raw) => {
    expect(resolveRequestedPage(raw)).toBe(1);
  });

  it('should_take_the_first_occurrence_of_a_repeated_parameter', () => {
    expect(resolveRequestedPage(['2', '5'])).toBe(2);
  });

  it('should_degrade_when_the_first_of_several_is_unusable', () => {
    expect(resolveRequestedPage(['no', '5'])).toBe(1);
  });

  it('should_discard_an_absurdly_long_value_before_parsing_it', () => {
    expect(resolveRequestedPage('2'.padEnd(500, '0'))).toBe(1);
  });

  it('should_bound_the_requested_page_so_it_can_never_become_an_absurd_offset', () => {
    // The bound is the whole point: an unclamped page number reaches the
    // database as a `skip` it will honour by walking and discarding rows.
    expect(resolveRequestedPage('999999999')).toBe(MAX_CLIENTS_PAGE);
    expect(skipFor(resolveRequestedPage('999999999'))).toBe(
      (MAX_CLIENTS_PAGE - 1) * CLIENTS_PAGE_SIZE
    );
  });

  it('should_never_throw_for_any_shape_of_input', () => {
    const hostile = [
      undefined,
      '',
      ' ',
      '-'.repeat(1000),
      "1; DROP TABLE clients; --",
      'Infinity',
      'NaN',
      '1e9',
      [] as string[],
      ['', ''],
    ];

    for (const raw of hostile) {
      expect(() => resolveRequestedPage(raw)).not.toThrow();
      expect(resolveRequestedPage(raw)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('clientPageParams - the last page', () => {
  it('should_report_one_page_for_an_empty_shop', () => {
    // Never zero: "page 0 of 0" is not a state the page can render, and a
    // shop with no clients still shows its empty state on page one.
    expect(lastPageFor(0)).toBe(1);
  });

  it('should_report_one_page_when_everything_fits', () => {
    expect(lastPageFor(1)).toBe(1);
    expect(lastPageFor(CLIENTS_PAGE_SIZE)).toBe(1);
  });

  it('should_report_two_pages_for_one_row_more_than_a_page', () => {
    expect(lastPageFor(CLIENTS_PAGE_SIZE + 1)).toBe(2);
  });

  it('should_round_a_partial_page_up', () => {
    expect(lastPageFor(CLIENTS_PAGE_SIZE * 2 + 1)).toBe(3);
  });
});

describe('clientPageParams - clamping against a real total', () => {
  it('should_leave_a_page_that_exists_alone', () => {
    expect(clampToLastPage(2, CLIENTS_PAGE_SIZE * 3)).toBe(2);
  });

  it('should_pull_a_page_beyond_the_last_back_to_the_last', () => {
    // Not to an empty table: an empty result on page nine hundred looks
    // exactly like a shop with no clients, which is a different fact.
    expect(clampToLastPage(900, CLIENTS_PAGE_SIZE * 2)).toBe(2);
  });

  it('should_pull_any_page_back_to_the_first_for_an_empty_shop', () => {
    expect(clampToLastPage(7, 0)).toBe(1);
  });

  it('should_produce_a_skip_that_can_never_exceed_the_total', () => {
    // The property, stated rather than described.
    for (const total of [0, 1, CLIENTS_PAGE_SIZE, CLIENTS_PAGE_SIZE * 4 + 3]) {
      for (const requested of [1, 2, 7, MAX_CLIENTS_PAGE]) {
        const skip = skipFor(clampToLastPage(requested, total));
        expect(skip).toBeLessThanOrEqual(Math.max(total - 1, 0));
      }
    }
  });
});

describe('clientPageParams - the page link', () => {
  it('should_omit_the_parameter_for_the_first_page', () => {
    // The unparameterised URL is the canonical one, and it is what the
    // navigation entry points at.
    expect(clientPageHref(1)).toBe('/clientes');
  });

  it('should_carry_the_page_for_any_other', () => {
    expect(clientPageHref(3)).toBe(`/clientes?${CLIENTS_PAGE_PARAM}=3`);
  });

  it('should_round_trip_through_the_resolver', () => {
    const href = clientPageHref(4);
    const raw = new URL(href, 'https://example.test').searchParams.get(CLIENTS_PAGE_PARAM);

    expect(resolveRequestedPage(raw ?? undefined)).toBe(4);
  });
});
