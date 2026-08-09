import { describe, it, expect } from 'vitest';
import { parseCreateBarber, parseUpdateBarber } from './barberSchema';

const VALID_LOCATION_ID = 'loc-cuid-1';

describe('parseCreateBarber', () => {
  it('should_accept_a_valid_displayName_locationId_and_bio', () => {
    const result = parseCreateBarber({
      displayName: 'Juan Pérez',
      locationId: VALID_LOCATION_ID,
      bio: 'Especialista en degradés.',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        displayName: 'Juan Pérez',
        locationId: VALID_LOCATION_ID,
        bio: 'Especialista en degradés.',
      },
    });
  });

  it('should_accept_a_missing_bio_as_null', () => {
    const result = parseCreateBarber({ displayName: 'Juan', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bio).toBeNull();
  });

  it('should_store_a_blank_bio_as_null', () => {
    const result = parseCreateBarber({ displayName: 'Juan', locationId: VALID_LOCATION_ID, bio: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bio).toBeNull();
  });

  it('should_store_an_empty_string_bio_as_null', () => {
    const result = parseCreateBarber({ displayName: 'Juan', locationId: VALID_LOCATION_ID, bio: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bio).toBeNull();
  });

  it('should_normalize_displayName_trimming_whitespace', () => {
    const result = parseCreateBarber({ displayName: '  Juan  ', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.displayName).toBe('Juan');
  });

  it('should_strip_bidi_chars_from_displayName', () => {
    const result = parseCreateBarber({ displayName: '‮Juan', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.displayName).toBe('Juan');
  });

  it('should_reject_a_whitespace_only_displayName_as_required', () => {
    const result = parseCreateBarber({ displayName: '   ', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.displayName).toBe('required');
  });

  it('should_reject_a_zero_width_only_displayName_as_required', () => {
    const result = parseCreateBarber({ displayName: '​​', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.displayName).toBe('required');
  });

  it('should_reject_a_displayName_of_1_char_after_normalization', () => {
    const result = parseCreateBarber({ displayName: 'A', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.displayName).toBe('invalid_length');
  });

  it('should_accept_a_displayName_of_2_chars_after_normalization', () => {
    const result = parseCreateBarber({ displayName: 'AB', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(true);
  });

  it('should_accept_a_displayName_of_120_chars_after_normalization', () => {
    const result = parseCreateBarber({
      displayName: 'A'.repeat(120),
      locationId: VALID_LOCATION_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('should_reject_a_displayName_of_121_chars_after_normalization', () => {
    const result = parseCreateBarber({
      displayName: 'A'.repeat(121),
      locationId: VALID_LOCATION_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.displayName).toBe('invalid_length');
  });

  it('should_accept_a_bio_at_500_chars', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      bio: 'B'.repeat(500),
    });
    expect(result.ok).toBe(true);
  });

  it('should_reject_a_bio_at_501_chars', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      bio: 'B'.repeat(501),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.bio).toBe('too_long');
  });

  it('should_reject_a_missing_locationId', () => {
    const result = parseCreateBarber({ displayName: 'Juan' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.locationId).toBe('required');
  });

  it('should_reject_an_empty_locationId', () => {
    const result = parseCreateBarber({ displayName: 'Juan', locationId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.locationId).toBe('required');
  });

  it('should_strip_injected_ownerId', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      ownerId: 'attacker',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain('ownerId');
  });

  it('should_strip_injected_isActive', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      isActive: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain('isActive');
  });

  it('should_strip_injected_avatarUrl', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      avatarUrl: 'http://evil.com/img.png',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain('avatarUrl');
  });

  it('should_strip_a_currentLocationId_shaped_key', () => {
    const result = parseCreateBarber({
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      currentLocationId: 'loc-inactive-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain('currentLocationId');
  });
});

describe('parseUpdateBarber', () => {
  it('should_accept_valid_id_with_valid_fields', () => {
    const result = parseUpdateBarber({
      id: 'barber-cuid-1',
      displayName: 'Carlos',
      locationId: VALID_LOCATION_ID,
      bio: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('barber-cuid-1');
      expect(result.data.displayName).toBe('Carlos');
    }
  });

  it('should_reject_a_missing_id', () => {
    const result = parseUpdateBarber({ displayName: 'Carlos', locationId: VALID_LOCATION_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.id).toBe('required');
  });

  it('should_apply_the_same_displayName_rules_as_create', () => {
    const result = parseUpdateBarber({
      id: 'barber-1',
      displayName: 'A',
      locationId: VALID_LOCATION_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.displayName).toBe('invalid_length');
  });

  it('should_strip_currentLocationId_on_update_too', () => {
    const result = parseUpdateBarber({
      id: 'barber-1',
      displayName: 'Juan',
      locationId: VALID_LOCATION_ID,
      currentLocationId: 'loc-inactive-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain('currentLocationId');
  });
});
