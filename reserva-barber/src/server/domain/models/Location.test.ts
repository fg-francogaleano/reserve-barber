import { describe, it, expect } from 'vitest';
import { normalizeLocationName } from './Location';

describe('normalizeLocationName', () => {
  it('should_trim_surrounding_whitespace', () => {
    expect(normalizeLocationName('  Sucursal Centro  ')).toBe('Sucursal Centro');
  });

  it('should_collapse_runs_of_internal_whitespace', () => {
    expect(normalizeLocationName('Sucursal   Centro')).toBe('Sucursal Centro');
  });

  it('should_collapse_mixed_whitespace_kinds_into_a_single_space', () => {
    // Tab, newline and a non-breaking space are all whitespace to a reader but
    // three different code points to a unique constraint.
    expect(normalizeLocationName('Sucursal\t\nCentro')).toBe('Sucursal Centro');
    expect(normalizeLocationName('Sucursal Centro')).toBe('Sucursal Centro');
  });

  it('should_apply_NFC_so_a_decomposed_accent_equals_its_composed_form', () => {
    const decomposed = 'Córdoba'; // o + combining acute accent
    const composed = 'Córdoba'; // precomposed ó

    expect(decomposed).not.toBe(composed); // precondition: they differ as bytes
    expect(normalizeLocationName(decomposed)).toBe(composed);
    expect(normalizeLocationName(decomposed)).toBe(normalizeLocationName(composed));
  });

  it('should_reduce_zero_width_only_input_to_empty', () => {
    // trim() does not remove U+200B, so without explicit stripping this would
    // pass a length check and render as an invisible location.
    expect(normalizeLocationName('​​​')).toBe('');
    expect(normalizeLocationName('‍﻿')).toBe('');
  });

  it('should_strip_zero_width_characters_embedded_in_a_name', () => {
    expect(normalizeLocationName('Sucursal​Centro')).toBe('SucursalCentro');
  });

  it('should_reduce_whitespace_only_input_to_empty', () => {
    expect(normalizeLocationName('   ')).toBe('');
    expect(normalizeLocationName('')).toBe('');
  });

  it('should_leave_an_already_normalized_name_unchanged', () => {
    expect(normalizeLocationName('Sucursal Centro')).toBe('Sucursal Centro');
  });

  it('should_preserve_characters_that_only_look_like_wildcards', () => {
    // These are ordinary characters here; they matter because a pattern-based
    // duplicate check would treat them as wildcards (design, first risk).
    expect(normalizeLocationName('Sucursal 50%')).toBe('Sucursal 50%');
    expect(normalizeLocationName('Sucursal_1')).toBe('Sucursal_1');
  });
});
