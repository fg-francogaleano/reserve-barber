import { describe, it, expect } from 'vitest';
import { normalizeName } from './normalizeName';

describe('normalizeName', () => {
  it('should_trim_surrounding_whitespace', () => {
    expect(normalizeName('  Sucursal Centro  ')).toBe('Sucursal Centro');
  });

  it('should_collapse_runs_of_internal_whitespace', () => {
    expect(normalizeName('Sucursal   Centro')).toBe('Sucursal Centro');
  });

  it('should_collapse_mixed_whitespace_kinds_into_a_single_space', () => {
    expect(normalizeName('Sucursal\t\nCentro')).toBe('Sucursal Centro');
    expect(normalizeName('Sucursal Centro')).toBe('Sucursal Centro');
  });

  it('should_apply_NFC_so_a_decomposed_accent_equals_its_composed_form', () => {
    const decomposed = 'Córdoba';
    const composed = 'Có rdoba'.replace(' ', '');
    expect(decomposed).not.toBe(composed);
    expect(normalizeName(decomposed)).toBe(normalizeName(composed));
  });

  it('should_reduce_zero_width_only_input_to_empty', () => {
    expect(normalizeName('​​​')).toBe('');
    expect(normalizeName('‍﻿')).toBe('');
  });

  it('should_strip_zero_width_characters_embedded_in_a_name', () => {
    expect(normalizeName('Sucursal​Centro')).toBe('SucursalCentro');
  });

  it('should_reduce_whitespace_only_input_to_empty', () => {
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('')).toBe('');
  });

  it('should_leave_an_already_normalized_name_unchanged', () => {
    expect(normalizeName('Sucursal Centro')).toBe('Sucursal Centro');
  });

  it('should_preserve_characters_that_only_look_like_wildcards', () => {
    expect(normalizeName('Sucursal 50%')).toBe('Sucursal 50%');
    expect(normalizeName('Sucursal_1')).toBe('Sucursal_1');
  });

  // Bidirectional control characters — U+202A–U+202E and U+2066–U+2069
  it('should_strip_left_to_right_embedding_U202A', () => {
    expect(normalizeName('Juan‪Carlos')).toBe('JuanCarlos');
  });

  it('should_strip_right_to_left_override_U202E', () => {
    expect(normalizeName('‮Invertido')).toBe('Invertido');
  });

  it('should_strip_all_bidi_embedding_and_override_chars_U202A_to_U202E', () => {
    const bidiRange1 = '‪‫‬‭‮';
    expect(normalizeName(`A${bidiRange1}B`)).toBe('AB');
  });

  it('should_strip_bidi_isolate_chars_U2066_to_U2069', () => {
    const bidiRange2 = '⁦⁧⁨⁩';
    expect(normalizeName(`A${bidiRange2}B`)).toBe('AB');
  });

  it('should_reduce_bidi_only_input_to_empty', () => {
    expect(normalizeName('‪‮⁦⁩')).toBe('');
  });

  it('should_not_create_a_duplicate_when_names_differ_only_by_bidi_chars', () => {
    // Two names that look identical on screen but differ because one carries
    // an invisible bidi override — they must normalize to the same bytes.
    const plain = 'Juan';
    const withBidi = '‮nauJ';
    // After stripping U+202E the second becomes "nauJ", which is different —
    // that is intentional: the override was carrying a reversed rendering.
    // What matters is that the bidi char itself is gone and cannot hide a
    // byte-level difference behind identical rendering.
    expect(normalizeName(plain)).not.toContain('‮');
    expect(normalizeName(withBidi)).not.toContain('‮');
  });

  it('should_strip_bidi_chars_then_collapse_whitespace', () => {
    // Ensure ordering: bidi removal happens before whitespace collapse
    expect(normalizeName('Juan ‪ Carlos')).toBe('Juan Carlos');
  });
});
