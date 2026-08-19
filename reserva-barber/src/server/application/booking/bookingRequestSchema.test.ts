import { describe, it, expect } from 'vitest';
import {
  parseBookingRequest,
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_EMAIL_MAX_LENGTH,
} from './bookingRequestSchema';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'barberia-don-juan',
    locationId: 'loc_123',
    serviceId: 'svc_123',
    barberId: 'brb_123',
    fecha: '2026-08-20',
    hora: '15:00',
    name: 'Ana Pérez',
    email: 'ana@mail.com',
    phone: '11 5555-4444',
    ...overrides,
  };
}

describe('parseBookingRequest - the happy shape', () => {
  it('should_accept_a_complete_submission', () => {
    const result = parseBookingRequest(valid());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('Ana Pérez');
    expect(result.data.email).toBe('ana@mail.com');
  });

  it('should_lowercase_and_trim_the_email_before_it_can_reach_the_unique_index', () => {
    const result = parseBookingRequest(valid({ email: '  Ana@Mail.COM  ' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.email).toBe('ana@mail.com');
  });

  it('should_normalize_the_phone_to_its_canonical_form', () => {
    const result = parseBookingRequest(valid({ phone: '011 15 5555 4444' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.phone).toBe('+5491155554444');
  });

  it('should_strip_unknown_keys_so_a_price_or_deposit_cannot_be_injected', () => {
    const result = parseBookingRequest(
      valid({ priceAtBooking: '1.00', depositAmount: '0.01', status: 'CONFIRMED' })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty('priceAtBooking');
    expect(result.data).not.toHaveProperty('depositAmount');
    expect(result.data).not.toHaveProperty('status');
  });
});

describe('parseBookingRequest - contact field rejections', () => {
  it('should_reject_a_one_character_name_as_too_short', () => {
    const result = parseBookingRequest(valid({ name: 'A' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.name).toBe('too_short');
  });

  it('should_accept_a_name_at_the_upper_bound', () => {
    const result = parseBookingRequest(valid({ name: 'a'.repeat(CLIENT_NAME_MAX_LENGTH) }));

    expect(result.ok).toBe(true);
  });

  it('should_reject_a_name_one_character_over_the_bound', () => {
    const result = parseBookingRequest(valid({ name: 'a'.repeat(CLIENT_NAME_MAX_LENGTH + 1) }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.name).toBe('too_long');
  });

  it('should_reject_a_missing_name', () => {
    const result = parseBookingRequest(valid({ name: '   ' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.name).toBe('required');
  });

  it('should_reject_an_email_over_its_bound', () => {
    const long = `${'a'.repeat(CLIENT_EMAIL_MAX_LENGTH)}@mail.com`;
    const result = parseBookingRequest(valid({ email: long }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.email).toBe('too_long');
  });

  it('should_reject_an_address_with_no_at_sign', () => {
    const result = parseBookingRequest(valid({ email: 'ana-at-mail.com' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.email).toBe('invalid_email');
  });

  it('should_reject_an_empty_phone', () => {
    const result = parseBookingRequest(valid({ phone: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.phone).toBe('required');
  });

  it('should_reject_a_phone_that_cannot_form_an_ar_number', () => {
    const result = parseBookingRequest(valid({ phone: '555' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.phone).toBe('invalid_phone');
  });

  it('should_report_every_bad_contact_field_at_once_rather_than_one_at_a_time', () => {
    // A rejection that reveals one mistake per round trip makes the client
    // resubmit three times to learn three things they typed at once.
    const result = parseBookingRequest(valid({ name: '', email: 'nope', phone: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.name).toBeDefined();
    expect(result.fieldErrors.email).toBeDefined();
    expect(result.fieldErrors.phone).toBeDefined();
  });
});

describe('parseBookingRequest - the selection is bounded, never field-reported', () => {
  it.each([
    ['slug', 'a'.repeat(200)],
    ['locationId', 'a'.repeat(200)],
    ['serviceId', 'a'.repeat(200)],
    ['barberId', 'a'.repeat(200)],
    ['fecha', 'a'.repeat(200)],
    ['hora', 'a'.repeat(200)],
  ])('should_refuse_an_oversized_%s_as_a_selection_failure', (field, oversized) => {
    const result = parseBookingRequest(valid({ [field]: oversized }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.selectionInvalid).toBe(true);
    expect(result.fieldErrors).toEqual({});
  });

  it('should_refuse_a_missing_selection_value', () => {
    const result = parseBookingRequest(valid({ barberId: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.selectionInvalid).toBe(true);
  });

  it('should_bound_hora_rather_than_interpreting_an_iso_timestamp', () => {
    // `hora` is matched against a generated list downstream, never parsed. A
    // short ISO-ish value passes the bound here and simply matches nothing.
    const result = parseBookingRequest(valid({ hora: '2026-08-20T15:00:00Z' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hora).toBe('2026-08-20T15:00:00Z');
  });

  it('should_refuse_an_entirely_absent_payload', () => {
    const result = parseBookingRequest(undefined);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.selectionInvalid).toBe(true);
  });
});
