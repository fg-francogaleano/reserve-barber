import { describe, it, expect } from 'vitest';
import { parseCreateLocation, parseUpdateLocation } from './locationSchema';

const validName = 'Sucursal Centro';

describe('parseCreateLocation', () => {
  it('should_accept_a_valid_name_and_address', () => {
    const result = parseCreateLocation({ name: validName, address: 'Av. Corrientes 1234' });

    expect(result).toEqual({ ok: true, data: { name: validName, address: 'Av. Corrientes 1234' } });
  });

  it('should_normalize_the_name_before_returning_it', () => {
    const result = parseCreateLocation({ name: '  Sucursal   Centro  ', address: '' });

    expect(result).toEqual({ ok: true, data: { name: 'Sucursal Centro', address: null } });
  });

  it('should_trim_the_address', () => {
    const result = parseCreateLocation({ name: validName, address: '  Av. Corrientes 1234  ' });

    expect(result.ok && result.data.address).toBe('Av. Corrientes 1234');
  });

  it('should_store_a_blank_or_missing_address_as_null', () => {
    expect(parseCreateLocation({ name: validName, address: '' })).toEqual({
      ok: true,
      data: { name: validName, address: null },
    });
    expect(parseCreateLocation({ name: validName, address: '   ' })).toEqual({
      ok: true,
      data: { name: validName, address: null },
    });
    expect(parseCreateLocation({ name: validName })).toEqual({
      ok: true,
      data: { name: validName, address: null },
    });
  });

  it('should_reject_an_empty_name_as_required', () => {
    for (const name of ['', '   ', '\t\n', '​​']) {
      const result = parseCreateLocation({ name, address: '' });
      expect(result).toEqual({ ok: false, fieldErrors: { name: 'required' } });
    }
  });

  it('should_reject_a_missing_or_non_string_name_as_required', () => {
    for (const name of [undefined, null, 42, {}]) {
      const result = parseCreateLocation({ name, address: '' });
      expect(result).toEqual({ ok: false, fieldErrors: { name: 'required' } });
    }
  });

  it('should_reject_a_name_shorter_than_two_characters', () => {
    const result = parseCreateLocation({ name: 'A', address: '' });

    expect(result).toEqual({ ok: false, fieldErrors: { name: 'invalid_length' } });
  });

  it('should_accept_names_at_the_length_boundaries', () => {
    expect(parseCreateLocation({ name: 'AB', address: '' }).ok).toBe(true);
    expect(parseCreateLocation({ name: 'A'.repeat(120), address: '' }).ok).toBe(true);
  });

  it('should_reject_a_name_longer_than_120_characters', () => {
    const result = parseCreateLocation({ name: 'A'.repeat(121), address: '' });

    expect(result).toEqual({ ok: false, fieldErrors: { name: 'invalid_length' } });
  });

  it('should_measure_length_after_normalization', () => {
    // 122 raw characters, 120 once the doubled spaces collapse.
    const raw = `${'A'.repeat(59)}  ${'B'.repeat(59)}`;
    const result = parseCreateLocation({ name: raw, address: '' });

    expect(result.ok && result.data.name.length).toBe(119);
  });

  it('should_accept_an_address_at_255_characters_and_reject_256', () => {
    expect(parseCreateLocation({ name: validName, address: 'A'.repeat(255) }).ok).toBe(true);
    expect(parseCreateLocation({ name: validName, address: 'A'.repeat(256) })).toEqual({
      ok: false,
      fieldErrors: { address: 'too_long' },
    });
  });

  it('should_report_every_invalid_field_at_once', () => {
    const result = parseCreateLocation({ name: '', address: 'A'.repeat(256) });

    expect(result).toEqual({
      ok: false,
      fieldErrors: { name: 'required', address: 'too_long' },
    });
  });

  it('should_ignore_unexpected_keys_including_an_injected_ownerId', () => {
    const result = parseCreateLocation({
      name: validName,
      address: '',
      ownerId: 'someone-else',
      isActive: false,
      id: 'forged',
    });

    expect(result).toEqual({ ok: true, data: { name: validName, address: null } });
  });

  it('should_preserve_characters_that_a_pattern_match_would_treat_as_wildcards', () => {
    const result = parseCreateLocation({ name: 'Sucursal 50%', address: '' });

    expect(result.ok && result.data.name).toBe('Sucursal 50%');
  });
});

describe('parseUpdateLocation', () => {
  it('should_accept_a_valid_id_with_valid_fields', () => {
    const result = parseUpdateLocation({ id: 'loc-1', name: validName, address: '' });

    expect(result).toEqual({
      ok: true,
      data: { id: 'loc-1', name: validName, address: null },
    });
  });

  it('should_reject_a_missing_or_blank_id', () => {
    for (const id of [undefined, null, '', '   ', 7]) {
      const result = parseUpdateLocation({ id, name: validName, address: '' });
      expect(result).toEqual({ ok: false, fieldErrors: { id: 'required' } });
    }
  });

  it('should_apply_the_same_name_rules_as_create', () => {
    expect(parseUpdateLocation({ id: 'loc-1', name: 'A', address: '' })).toEqual({
      ok: false,
      fieldErrors: { name: 'invalid_length' },
    });
  });
});
