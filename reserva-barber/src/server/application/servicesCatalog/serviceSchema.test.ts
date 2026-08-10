import { describe, it, expect } from 'vitest';
import {
  parseCreateService,
  parseUpdateService,
  MAX_PRICE,
  SERVICE_NAME_MAX_LENGTH,
  SERVICE_DESCRIPTION_MAX_LENGTH,
} from './serviceSchema';

const validBase = { name: 'Corte Clásico', price: '4500', durationMinutes: '30' };

function createWith(overrides: Record<string, unknown>) {
  return parseCreateService({ ...validBase, ...overrides });
}

/** Narrows the result and fails loudly when the parse went the other way. */
function expectOk(result: ReturnType<typeof parseCreateService>) {
  if (!result.ok) {
    throw new Error(`expected ok, got field errors: ${JSON.stringify(result.fieldErrors)}`);
  }
  return result.data;
}

function expectFieldError(result: ReturnType<typeof parseCreateService>, field: string, code: string) {
  if (result.ok) {
    throw new Error(`expected a ${field} error, but the parse succeeded`);
  }
  expect(result.fieldErrors[field as keyof typeof result.fieldErrors]).toBe(code);
}

// ---------------------------------------------------------------- price (6.1)

describe('serviceSchema - price parsing', () => {
  it('should_accept_an_integer_price', () => {
    expect(expectOk(createWith({ price: '4500' })).price).toBe('4500.00');
  });

  it('should_accept_a_dot_decimal_separator', () => {
    expect(expectOk(createWith({ price: '4500.50' })).price).toBe('4500.50');
  });

  it('should_accept_a_comma_decimal_separator', () => {
    // The es-AR keyboard produces this; the platform expects the dot. The owner
    // must not have to know which one won.
    expect(expectOk(createWith({ price: '4500,50' })).price).toBe('4500.50');
  });

  it('should_canonicalize_both_separators_identically', () => {
    const withDot = expectOk(createWith({ price: '4500.50' })).price;
    const withComma = expectOk(createWith({ price: '4500,50' })).price;
    expect(withComma).toBe(withDot);
  });

  it('should_accept_one_decimal_place_and_pad_it', () => {
    expect(expectOk(createWith({ price: '4500.5' })).price).toBe('4500.50');
  });

  it('should_accept_zero', () => {
    // data-model.md §6 says >= 0. The deposit consequence belongs to PC3.
    expect(expectOk(createWith({ price: '0' })).price).toBe('0.00');
  });

  it('should_trim_surrounding_whitespace', () => {
    expect(expectOk(createWith({ price: '  4500,50  ' })).price).toBe('4500.50');
  });

  it('should_strip_redundant_leading_zeros', () => {
    expect(expectOk(createWith({ price: '004500' })).price).toBe('4500.00');
    expect(expectOk(createWith({ price: '0.50' })).price).toBe('0.50');
  });

  it.each(['4.500', '4,500', '1.234.567', '4.500,50', '4,500.50'])(
    'should_reject_%s_as_an_ambiguous_thousands_separator',
    (price) => {
      // A wrong guess here is a thousandfold pricing error that surfaces only
      // at reconciliation. Refusing costs one retype.
      expectFieldError(createWith({ price }), 'price', 'thousands_separator');
    }
  );

  it('should_reject_more_than_two_decimals_without_rounding', () => {
    const result = createWith({ price: '4500.555' });
    expectFieldError(result, 'price', 'too_many_decimals');
    // The owner must see the price they will charge — never a rounded guess.
    expect(JSON.stringify(result)).not.toContain('4500.55');
    expect(JSON.stringify(result)).not.toContain('4500.56');
  });

  it.each(['abc', '1e5', 'Infinity', 'NaN', '-1', '-4500.50', '1_000', '4 500', '$4500', ''])(
    'should_reject_%s_as_an_invalid_price',
    (price) => {
      const result = createWith({ price });
      expect(result.ok).toBe(false);
    }
  );

  it('should_reject_a_missing_price_as_required', () => {
    expectFieldError(createWith({ price: '   ' }), 'price', 'required');
  });

  it('should_accept_the_maximum', () => {
    expect(expectOk(createWith({ price: String(MAX_PRICE) })).price).toBe('9999999.99');
  });

  it('should_reject_above_the_maximum_before_it_reaches_the_database', () => {
    // Validation is strictly tighter than Decimal(12,2) so a numeric overflow —
    // which PostgreSQL raises untyped — is unreachable by construction.
    expectFieldError(createWith({ price: '10000000' }), 'price', 'too_large');
    expectFieldError(createWith({ price: '99999999999999' }), 'price', 'too_large');
  });
});

// ------------------------------------------------------------- duration (6.2)

describe('serviceSchema - duration', () => {
  it('should_accept_a_multiple_of_the_granularity', () => {
    expect(expectOk(createWith({ durationMinutes: '30' })).durationMinutes).toBe(30);
    expect(expectOk(createWith({ durationMinutes: '20' })).durationMinutes).toBe(20);
  });

  it('should_reject_a_duration_that_does_not_tile_the_grid', () => {
    expectFieldError(createWith({ durationMinutes: '37' }), 'durationMinutes', 'not_multiple');
  });

  it.each(['0', '4', '481', '600'])('should_reject_%s_as_out_of_range', (durationMinutes) => {
    const result = createWith({ durationMinutes });
    expect(result.ok).toBe(false);
  });

  it.each(['4.5', 'abc', '-15', '3e1', ''])(
    'should_reject_%s_as_an_invalid_duration',
    (durationMinutes) => {
      const result = createWith({ durationMinutes });
      expect(result.ok).toBe(false);
    }
  );

  it('should_accept_the_boundaries', () => {
    expect(expectOk(createWith({ durationMinutes: '5' })).durationMinutes).toBe(5);
    expect(expectOk(createWith({ durationMinutes: '480' })).durationMinutes).toBe(480);
  });
});

// -------------------------------------------------- name & description (6.3)

describe('serviceSchema - name', () => {
  it('should_collapse_and_trim_whitespace', () => {
    expect(expectOk(createWith({ name: '  Corte   Clásico  ' })).name).toBe('Corte Clásico');
  });

  it('should_strip_zero_width_and_bidi_characters', () => {
    expect(expectOk(createWith({ name: 'Cor​te‮' })).name).toBe('Corte');
  });

  it('should_accept_the_length_boundaries', () => {
    expect(expectOk(createWith({ name: 'ab' })).name).toBe('ab');
    const max = 'a'.repeat(SERVICE_NAME_MAX_LENGTH);
    expect(expectOk(createWith({ name: max })).name).toBe(max);
  });

  it('should_reject_below_and_above_the_length_boundaries', () => {
    expectFieldError(createWith({ name: 'a' }), 'name', 'invalid_length');
    expectFieldError(
      createWith({ name: 'a'.repeat(SERVICE_NAME_MAX_LENGTH + 1) }),
      'name',
      'invalid_length'
    );
  });

  it.each(['   ', '​​​', '‪‫'])(
    'should_treat_an_invisible_only_name_as_empty',
    (name) => {
      expectFieldError(createWith({ name }), 'name', 'required');
    }
  );
});

describe('serviceSchema - description', () => {
  it('should_store_a_blank_description_as_null', () => {
    expect(expectOk(createWith({ description: '   ' })).description).toBeNull();
    expect(expectOk(createWith({ description: undefined })).description).toBeNull();
  });

  it('should_accept_the_maximum_length', () => {
    const max = 'a'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH);
    expect(expectOk(createWith({ description: max })).description).toBe(max);
  });

  it('should_reject_above_the_maximum_length', () => {
    expectFieldError(
      createWith({ description: 'a'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH + 1) }),
      'description',
      'too_long'
    );
  });
});

// ------------------------------------------------------- injected keys (6.3)

describe('serviceSchema - unknown keys', () => {
  it('should_strip_injected_ownership_and_state_fields', () => {
    const data = expectOk(
      createWith({ ownerId: 'someone-else', isActive: false, id: 'forged', createdAt: '2000-01-01' })
    );
    expect(data).toEqual({
      name: 'Corte Clásico',
      description: null,
      price: '4500.00',
      durationMinutes: 30,
    });
  });
});

describe('serviceSchema - update variant', () => {
  it('should_require_an_id', () => {
    const result = parseUpdateService({ ...validBase });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.id).toBe('required');
  });

  it('should_carry_the_id_through_and_still_strip_ownership', () => {
    const result = parseUpdateService({ ...validBase, id: 'svc-1', ownerId: 'someone-else' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('svc-1');
      expect(result.data).not.toHaveProperty('ownerId');
    }
  });
});
