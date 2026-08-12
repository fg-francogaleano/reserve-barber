import { describe, it, expect } from 'vitest';
import { slugify, SLUG_MIN_LENGTH, SLUG_MAX_LENGTH, SLUG_PATTERN } from './slugify';

describe('slugify', () => {
  describe('the canonical form', () => {
    it('lowercases', () => {
      expect(slugify('BARBERIA')).toBe('barberia');
    });

    it('strips diacritics rather than dropping the letter', () => {
      expect(slugify('Barbería Don Juan')).toBe('barberia-don-juan');
    });

    it('handles the Spanish characters this market actually types', () => {
      expect(slugify('Peluquería Ñuñez')).toBe('peluqueria-nunez');
      expect(slugify('Salón Álvarez')).toBe('salon-alvarez');
    });

    it('collapses any run of non-alphanumerics into a single hyphen', () => {
      expect(slugify('Don   Juan')).toBe('don-juan');
      expect(slugify('Don & Juan')).toBe('don-juan');
      expect(slugify('Don---Juan')).toBe('don-juan');
      expect(slugify('Don_._Juan')).toBe('don-juan');
    });

    it('trims leading and trailing hyphens', () => {
      expect(slugify('  Don Juan  ')).toBe('don-juan');
      expect(slugify('---Don Juan---')).toBe('don-juan');
      expect(slugify('¡Don Juan!')).toBe('don-juan');
    });

    it('keeps digits', () => {
      expect(slugify('Barberia 24hs')).toBe('barberia-24hs');
    });
  });

  describe('idempotence', () => {
    // If slugifying a slug changed it, the value stored yesterday and the value
    // computed today could differ, and the unique index would stop comparing
    // like with like.
    it('leaves an already-canonical value untouched', () => {
      expect(slugify('barberia-don-juan')).toBe('barberia-don-juan');
    });

    it('is stable under repeated application', () => {
      const once = slugify('Barbería  Don Juan!!');
      expect(slugify(once)).toBe(once);
    });
  });

  describe('input that carries no slug at all', () => {
    // Returning an empty string rather than throwing: "there is nothing to
    // suggest" is a normal state of the editor as the owner starts typing, and
    // it is the validation layer's job to reject an empty submission.
    it('returns empty for whitespace only', () => {
      expect(slugify('   ')).toBe('');
    });

    it('returns empty for punctuation only', () => {
      expect(slugify('!!!')).toBe('');
      expect(slugify('---')).toBe('');
    });

    it('returns empty for an empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('returns empty for characters that carry no ASCII equivalent', () => {
      // A name written entirely in emoji or in a non-Latin script leaves nothing
      // behind. The suggestion is empty and the owner types their own.
      expect(slugify('🎉🎉')).toBe('');
      expect(slugify('日本語')).toBe('');
    });
  });

  describe('invisible characters', () => {
    // Same class of input normalizeName defends against: a zero-width space
    // between two words would otherwise survive as a hyphen and produce a slug
    // nobody can retype.
    it('does not turn a zero-width space into a separator', () => {
      expect(slugify('Don​Juan')).toBe('donjuan');
    });

    it('ignores bidi control characters', () => {
      expect(slugify('Don‮Juan')).toBe('donjuan');
    });
  });

  describe('length', () => {
    it('clamps to the maximum without leaving a trailing hyphen', () => {
      const long = `${'a'.repeat(SLUG_MAX_LENGTH - 1)} ${'b'.repeat(20)}`;
      const result = slugify(long);

      expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      expect(result.endsWith('-')).toBe(false);
    });

    it('does not pad a short value up to the minimum', () => {
      // Enforcing the minimum is validation's job. Padding here would invent a
      // slug the owner never chose.
      expect(slugify('ab')).toBe('ab');
      expect('ab'.length).toBeLessThan(SLUG_MIN_LENGTH);
    });
  });

  describe('the shared pattern', () => {
    it('accepts every value slugify can produce', () => {
      const produced = [
        slugify('Barbería Don Juan'),
        slugify('Barberia 24hs'),
        slugify('---Don---Juan---'),
        slugify('a'),
      ].filter((value) => value.length > 0);

      for (const value of produced) {
        expect(SLUG_PATTERN.test(value)).toBe(true);
      }
    });

    it('rejects the shapes the editor must refuse', () => {
      expect(SLUG_PATTERN.test('Barberia')).toBe(false);
      expect(SLUG_PATTERN.test('don juan')).toBe(false);
      expect(SLUG_PATTERN.test('-donjuan')).toBe(false);
      expect(SLUG_PATTERN.test('donjuan-')).toBe(false);
      expect(SLUG_PATTERN.test('don--juan')).toBe(false);
      expect(SLUG_PATTERN.test('')).toBe(false);
    });
  });
});
