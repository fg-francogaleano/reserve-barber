import { describe, it, expect } from 'vitest';
import {
  parseSaveBusinessProfile,
  BUSINESS_NAME_MIN_LENGTH,
  BUSINESS_NAME_MAX_LENGTH,
  BIO_MAX_LENGTH,
  SOCIAL_URL_MAX_LENGTH,
} from './businessProfileSchema';
import { MAX_SOCIAL_LINKS } from '@/server/domain/models/BusinessProfile';

/** The minimum valid submission, so each test varies one thing. */
function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    businessName: 'Barbería Don Juan',
    bio: '',
    publicSlug: 'barberia-don-juan',
    socialPlatforms: [],
    socialUrls: [],
    photoIntent: 'unchanged',
    coverIntent: 'unchanged',
    ...overrides,
  };
}

function expectOk(input: Record<string, unknown>) {
  const result = parseSaveBusinessProfile(input);
  if (!result.ok) {
    throw new Error(`Expected parse to succeed, got ${JSON.stringify(result.fieldErrors)}`);
  }
  return result.data;
}

function expectFail(input: Record<string, unknown>) {
  const result = parseSaveBusinessProfile(input);
  if (result.ok) {
    throw new Error('Expected parse to fail, but it succeeded');
  }
  return result.fieldErrors;
}

describe('businessProfileSchema', () => {
  describe('businessName', () => {
    it('normalizes before measuring', () => {
      expect(expectOk(validInput({ businessName: '  Don   Juan  ' })).businessName).toBe('Don Juan');
    });

    it('rejects an empty name as required', () => {
      expect(expectFail(validInput({ businessName: '' })).businessName).toBe('required');
    });

    it('rejects a whitespace-only name as required, not as too short', () => {
      expect(expectFail(validInput({ businessName: '     ' })).businessName).toBe('required');
    });

    it('rejects a name of only invisible characters as required', () => {
      expect(expectFail(validInput({ businessName: '​​' })).businessName).toBe('required');
    });

    it('rejects a name shorter than the minimum', () => {
      expect(expectFail(validInput({ businessName: 'a' })).businessName).toBe('invalid_length');
      expect(BUSINESS_NAME_MIN_LENGTH).toBe(2);
    });

    it('rejects a name longer than the maximum', () => {
      const tooLong = 'a'.repeat(BUSINESS_NAME_MAX_LENGTH + 1);
      expect(expectFail(validInput({ businessName: tooLong })).businessName).toBe('invalid_length');
    });

    it('accepts a name exactly at the maximum', () => {
      const atLimit = 'a'.repeat(BUSINESS_NAME_MAX_LENGTH);
      expect(expectOk(validInput({ businessName: atLimit })).businessName).toBe(atLimit);
    });

    it('rejects a missing field the same way as an empty one', () => {
      expect(expectFail(validInput({ businessName: undefined })).businessName).toBe('required');
    });
  });

  describe('bio', () => {
    it('stores a blank bio as absence, not as an empty string', () => {
      expect(expectOk(validInput({ bio: '' })).bio).toBeNull();
      expect(expectOk(validInput({ bio: '   ' })).bio).toBeNull();
    });

    it('keeps a real bio', () => {
      expect(expectOk(validInput({ bio: 'Cortes clásicos desde 1998.' })).bio).toBe(
        'Cortes clásicos desde 1998.'
      );
    });

    it('rejects a bio over the maximum', () => {
      const tooLong = 'a'.repeat(BIO_MAX_LENGTH + 1);
      expect(expectFail(validInput({ bio: tooLong })).bio).toBe('too_long');
    });

    it('accepts a bio exactly at the maximum', () => {
      const atLimit = 'a'.repeat(BIO_MAX_LENGTH);
      expect(expectOk(validInput({ bio: atLimit })).bio).toBe(atLimit);
    });

    it('measures code units, which is stricter than the column and never looser', () => {
      // Each astral character is two UTF-16 code units but one character in
      // PostgreSQL. Rejecting here what the column would have accepted is the
      // safe direction; the reverse would be a runtime overflow.
      const astral = '𝕏'.repeat(BIO_MAX_LENGTH);
      expect(astral.length).toBeGreaterThan(BIO_MAX_LENGTH);
      expect(expectFail(validInput({ bio: astral })).bio).toBe('too_long');
    });
  });

  describe('publicSlug', () => {
    it('normalizes a submitted display string to its canonical form', () => {
      expect(expectOk(validInput({ publicSlug: 'Barbería Don Juan' })).publicSlug).toBe(
        'barberia-don-juan'
      );
    });

    it('leaves an already-canonical slug untouched', () => {
      expect(expectOk(validInput({ publicSlug: 'barberia-don-juan' })).publicSlug).toBe(
        'barberia-don-juan'
      );
    });

    it('rejects an empty slug as required', () => {
      expect(expectFail(validInput({ publicSlug: '' })).publicSlug).toBe('required');
    });

    it('rejects a slug that normalizes to nothing as required', () => {
      expect(expectFail(validInput({ publicSlug: '!!!' })).publicSlug).toBe('required');
      expect(expectFail(validInput({ publicSlug: '🎉' })).publicSlug).toBe('required');
    });

    it('rejects a slug shorter than the minimum', () => {
      expect(expectFail(validInput({ publicSlug: 'ab' })).publicSlug).toBe('invalid_length');
    });

    it('normalization collapses the shapes the pattern forbids rather than rejecting them', () => {
      // "don--juan" and "-don-juan-" are not errors the owner has to fix: they
      // canonicalize. Only what carries no slug at all is refused.
      expect(expectOk(validInput({ publicSlug: 'don--juan' })).publicSlug).toBe('don-juan');
      expect(expectOk(validInput({ publicSlug: '-don-juan-' })).publicSlug).toBe('don-juan');
      expect(expectOk(validInput({ publicSlug: 'Don Juan' })).publicSlug).toBe('don-juan');
    });

    it('clamps an over-long slug rather than rejecting it', () => {
      const long = 'a'.repeat(200);
      expect(expectOk(validInput({ publicSlug: long })).publicSlug.length).toBe(60);
    });
  });

  describe('social links', () => {
    it('accepts a well-formed set and assigns order from position', () => {
      const data = expectOk(
        validInput({
          socialPlatforms: ['INSTAGRAM', 'WHATSAPP'],
          socialUrls: ['https://instagram.com/donjuan', 'https://wa.me/5491100000000'],
        })
      );

      expect(data.socialLinks).toEqual([
        { platform: 'INSTAGRAM', url: 'https://instagram.com/donjuan', orderIndex: 0 },
        { platform: 'WHATSAPP', url: 'https://wa.me/5491100000000', orderIndex: 1 },
      ]);
    });

    it('discards fully blank rows without reporting them', () => {
      const data = expectOk(
        validInput({
          socialPlatforms: ['INSTAGRAM', '', ''],
          socialUrls: ['https://instagram.com/donjuan', '', '   '],
        })
      );

      expect(data.socialLinks).toHaveLength(1);
      expect(data.socialLinks[0]?.orderIndex).toBe(0);
    });

    it('renumbers order after blank rows are discarded', () => {
      const data = expectOk(
        validInput({
          socialPlatforms: ['INSTAGRAM', '', 'TIKTOK'],
          socialUrls: ['https://instagram.com/a', '', 'https://tiktok.com/@a'],
        })
      );

      expect(data.socialLinks.map((link) => link.orderIndex)).toEqual([0, 1]);
    });

    it('rejects a platform with no url', () => {
      const errors = expectFail(
        validInput({ socialPlatforms: ['INSTAGRAM'], socialUrls: [''] })
      );
      expect(errors.socialLinks?.[0]).toBe('required');
    });

    it('rejects a url with no platform', () => {
      const errors = expectFail(
        validInput({ socialPlatforms: [''], socialUrls: ['https://instagram.com/a'] })
      );
      expect(errors.socialLinks?.[0]).toBe('required');
    });

    it('rejects an unknown platform', () => {
      const errors = expectFail(
        validInput({ socialPlatforms: ['MYSPACE'], socialUrls: ['https://myspace.com/a'] })
      );
      expect(errors.socialLinks?.[0]).toBe('unknown_platform');
    });

    it('rejects two rows on the same platform, pointing at the second', () => {
      const errors = expectFail(
        validInput({
          socialPlatforms: ['INSTAGRAM', 'INSTAGRAM'],
          socialUrls: ['https://instagram.com/a', 'https://instagram.com/b'],
        })
      );
      expect(errors.socialLinks?.[1]).toBe('duplicate_platform');
      expect(errors.socialLinks?.[0]).toBeUndefined();
    });

    it('rejects more rows than there are platforms', () => {
      const platforms = Array.from({ length: MAX_SOCIAL_LINKS + 1 }, () => 'INSTAGRAM');
      const urls = platforms.map((_, index) => `https://instagram.com/${index}`);
      expect(expectFail(validInput({ socialPlatforms: platforms, socialUrls: urls })).socialLinksForm).toBe(
        'too_many'
      );
    });

    describe('url protocol', () => {
      it('rejects a javascript url', () => {
        const errors = expectFail(
          validInput({ socialPlatforms: ['WEBSITE'], socialUrls: ['javascript:alert(1)'] })
        );
        expect(errors.socialLinks?.[0]).toBe('invalid_protocol');
      });

      it('rejects a javascript url however it is cased or spaced', () => {
        for (const hostile of ['JavaScript:alert(1)', '  javascript:alert(1)', 'JAVASCRIPT:alert(1)']) {
          const errors = expectFail(
            validInput({ socialPlatforms: ['WEBSITE'], socialUrls: [hostile] })
          );
          expect(errors.socialLinks?.[0]).toBe('invalid_protocol');
        }
      });

      it('rejects data and file urls', () => {
        for (const hostile of ['data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
          const errors = expectFail(
            validInput({ socialPlatforms: ['WEBSITE'], socialUrls: [hostile] })
          );
          expect(errors.socialLinks?.[0]).toBe('invalid_protocol');
        }
      });

      it('rejects a string that is not a url at all', () => {
        const errors = expectFail(
          validInput({ socialPlatforms: ['WEBSITE'], socialUrls: ['no soy una url'] })
        );
        expect(errors.socialLinks?.[0]).toBe('invalid_format');
      });

      it('accepts http as well as https', () => {
        const data = expectOk(
          validInput({ socialPlatforms: ['WEBSITE'], socialUrls: ['http://barberia.com.ar'] })
        );
        expect(data.socialLinks[0]?.url).toBe('http://barberia.com.ar');
      });

      it('rejects a url over the maximum length', () => {
        const tooLong = `https://example.com/${'a'.repeat(SOCIAL_URL_MAX_LENGTH)}`;
        const errors = expectFail(
          validInput({ socialPlatforms: ['WEBSITE'], socialUrls: [tooLong] })
        );
        expect(errors.socialLinks?.[0]).toBe('too_long');
      });
    });
  });

  describe('image intent', () => {
    it('reads unchanged, replace and remove as three distinct states', () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });

      expect(expectOk(validInput({ photoIntent: 'unchanged' })).photo).toEqual({ intent: 'unchanged' });
      expect(expectOk(validInput({ photoIntent: 'remove' })).photo).toEqual({ intent: 'remove' });
      expect(expectOk(validInput({ photoIntent: 'replace', photo: file })).photo).toEqual({
        intent: 'replace',
        file,
      });
    });

    it('treats an absent intent as unchanged, never as a removal', () => {
      // The defect this guards: a resubmitted form sends empty file inputs, and
      // reading that as "remove" would delete both images whenever the owner
      // edits only their bio.
      expect(expectOk(validInput({ photoIntent: undefined })).photo).toEqual({ intent: 'unchanged' });
      expect(expectOk(validInput({ photoIntent: '' })).photo).toEqual({ intent: 'unchanged' });
    });

    it('treats an empty file with no intent as unchanged', () => {
      const empty = new File([], '', { type: 'application/octet-stream' });
      expect(expectOk(validInput({ photoIntent: undefined, photo: empty })).photo).toEqual({
        intent: 'unchanged',
      });
    });

    it('rejects a replace intent that carries no file', () => {
      expect(expectFail(validInput({ photoIntent: 'replace' })).photo).toBe('required');
    });

    it('rejects a replace intent carrying an empty file', () => {
      const empty = new File([], 'photo.png', { type: 'image/png' });
      expect(expectFail(validInput({ photoIntent: 'replace', photo: empty })).photo).toBe('required');
    });

    it('rejects an unrecognized intent rather than guessing', () => {
      expect(expectFail(validInput({ photoIntent: 'delete-everything' })).photo).toBe('invalid_format');
    });

    it('tracks the two slots independently', () => {
      const file = new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' });
      const data = expectOk(validInput({ photoIntent: 'remove', coverIntent: 'replace', cover: file }));

      expect(data.photo).toEqual({ intent: 'remove' });
      expect(data.cover).toEqual({ intent: 'replace', file });
    });
  });

  describe('the boundary', () => {
    it('strips keys the form has no business submitting', () => {
      const data = expectOk(
        validInput({ id: 'injected', ownerId: 'someone-else', createdAt: 'whenever' })
      );

      expect(data).not.toHaveProperty('id');
      expect(data).not.toHaveProperty('ownerId');
      expect(data).not.toHaveProperty('createdAt');
    });

    it('reports every offending field at once rather than one at a time', () => {
      const errors = expectFail(
        validInput({ businessName: '', publicSlug: '', bio: 'a'.repeat(BIO_MAX_LENGTH + 1) })
      );

      expect(errors.businessName).toBe('required');
      expect(errors.publicSlug).toBe('required');
      expect(errors.bio).toBe('too_long');
    });

    it('survives a null input without throwing', () => {
      const result = parseSaveBusinessProfile(null);
      expect(result.ok).toBe(false);
    });
  });
});
