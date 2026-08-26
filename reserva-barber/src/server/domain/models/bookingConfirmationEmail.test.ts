import { describe, it, expect } from 'vitest';
import {
  buildBookingConfirmationEmail,
  type ConfirmationEmailBooking,
} from './bookingConfirmationEmail';

/**
 * A booking at 15:30 business-local on Saturday 30 August 2026.
 *
 * Argentina is UTC-3 and observes no DST, so this is 18:30Z. Written as the
 * instant rather than as a local string, because that is what the repository
 * boundary hands over and the whole point of these tests is that the builder
 * converts it rather than printing it.
 */
const START = new Date('2026-08-30T18:30:00.000Z');

function bookingWith(overrides: Partial<ConfirmationEmailBooking> = {}): ConfirmationEmailBooking {
  return {
    clientName: 'Ana Pérez',
    clientEmail: 'ana@example.com',
    shopName: 'Barbería Central',
    shopSlug: 'barberia-central',
    locationName: 'Sucursal Palermo',
    locationAddress: 'Gorriti 4500',
    barberName: 'Nico',
    serviceName: 'Corte y barba',
    startTime: START,
    priceAtBooking: '9000.00',
    depositAmount: '2000.50',
    cancellationToken: 'tok-abc123',
    ...overrides,
  };
}

const ORIGIN = 'https://reserva.example.com';

describe('buildBookingConfirmationEmail - the appointment', () => {
  it('should_render_the_appointment_in_the_business_timezone_not_utc', () => {
    // Arrange: 18:30Z is 15:30 in Buenos Aires.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: the local time, and never the stored UTC hour.
    expect(message.text).toContain('15:30');
    expect(message.text).not.toContain('18:30');
    expect(message.html).toContain('15:30');
    expect(message.html).not.toContain('18:30');
  });

  it('should_render_the_business_local_calendar_day', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: 30 August 2026 is a Sunday, and the es-AR long format punctuates
    // it with a comma.
    expect(message.text).toContain('domingo, 30 de agosto');
  });

  it('should_not_shift_the_day_for_an_appointment_near_local_midnight', () => {
    // Arrange: 00:30 local on 31 August is 03:30Z the same day. A builder that
    // formatted the instant in UTC would still say the 31st here, so the
    // opposite direction is the one that discriminates: 21:00 local on the 30th
    // is 00:00Z on the 31st.
    const booking = bookingWith({ startTime: new Date('2026-08-31T00:00:00.000Z') });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: still the 30th, business-local.
    expect(message.text).toContain('30 de agosto');
    expect(message.text).toContain('21:00');
  });

  it('should_name_the_branch_the_barber_and_the_service', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    for (const part of [message.text, message.html]) {
      expect(part).toContain('Sucursal Palermo');
      expect(part).toContain('Gorriti 4500');
      expect(part).toContain('Nico');
      expect(part).toContain('Corte y barba');
    }
  });

  it('should_omit_the_address_line_when_the_branch_has_none', () => {
    // Arrange
    const booking = bookingWith({ locationAddress: null });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: no empty label left dangling.
    expect(message.text).not.toContain('Dirección');
  });
});

describe('buildBookingConfirmationEmail - the money', () => {
  it('should_format_a_deposit_whose_stored_scale_the_driver_truncated', () => {
    // Arrange: the driver returns a stored 2000.50 as "2000.5". Rendering the
    // lone 5 as five centavos is the defect PC3 measured, and an email cannot
    // be corrected after sending.
    const booking = bookingWith({ depositAmount: '2000.5' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.text).toContain('2.000,50');
    expect(message.text).not.toContain('2.000,05');
  });

  it('should_state_the_balance_payable_at_the_shop', () => {
    // Arrange: 9000.00 - 2000.50 = 6999.50.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.text).toContain('6.999,50');
  });

  it('should_omit_the_balance_when_the_deposit_covered_the_whole_price', () => {
    // Arrange
    const booking = bookingWith({ priceAtBooking: '9000.00', depositAmount: '9000.00' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: no "a pagar en el local" line at all, which is the property.
    // Asserting on the formatted zero would be wrong — "$ 9.000,00" contains
    // "0,00" as a substring, so that test passes and fails for the wrong reason.
    expect(message.text).not.toContain('A pagar en el local');
    expect(message.html).not.toContain('A pagar en el local');
  });

  it('should_compute_the_balance_in_integer_cents_rather_than_in_floats', () => {
    // Arrange: 0.1 + 0.2 arithmetic on this pair yields 6999.499999... in
    // binary floating point.
    const booking = bookingWith({ priceAtBooking: '7000.10', depositAmount: '0.60' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.text).toContain('6.999,50');
  });
});

describe('buildBookingConfirmationEmail - the link', () => {
  it('should_compose_the_link_from_the_origin_the_slug_and_the_token', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    const expected = `${ORIGIN}/b/barberia-central/reserva/tok-abc123`;
    expect(message.text).toContain(expected);
    expect(message.html).toContain(expected);
  });

  it('should_render_the_link_as_readable_text_in_both_parts', () => {
    // Arrange: a button-only link disappears in a plain-text rendering, which
    // is exactly where the reader most needs the URL.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: present in the html as visible text, not only inside an href.
    const url = `${ORIGIN}/b/barberia-central/reserva/tok-abc123`;
    expect(message.html.split(url).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('should_percent_encode_a_token_carrying_url_unsafe_characters', () => {
    // Arrange
    const booking = bookingWith({ cancellationToken: 'a b/c' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.text).toContain('/reserva/a%20b%2Fc');
  });

  it('should_omit_the_link_entirely_when_no_origin_resolves', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: null });

    // Assert: no relative URL and no bare path stub anywhere.
    for (const part of [message.text, message.html]) {
      expect(part).not.toContain('/reserva/');
      expect(part).not.toContain('tok-abc123');
      expect(part).not.toContain('localhost');
      expect(part).not.toContain('href="/');
    }
  });

  it('should_still_confirm_the_appointment_when_no_origin_resolves', () => {
    // Arrange: the confirmation is the primary value; the link is secondary.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: null });

    // Assert
    expect(message.text).toContain('15:30');
    expect(message.subject.length).toBeGreaterThan(0);
  });
});

describe('buildBookingConfirmationEmail - guest-supplied values', () => {
  it('should_escape_markup_in_the_client_name', () => {
    // Arrange
    const booking = bookingWith({ clientName: '<img src=x onerror=alert(1)>' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: the property is that the name cannot open a tag, not that the
    // word "onerror" is absent — as escaped text it is inert, and asserting on
    // it would fail a correct implementation.
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
    expect(message.html).toContain('&gt;');
  });

  it('should_escape_a_name_that_tries_to_close_an_attribute', () => {
    // Arrange: the greeting is not inside an attribute today, but the escaping
    // must not depend on where a later change puts it.
    const booking = bookingWith({ clientName: '" onmouseover="x' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.html).toContain('&quot;');
    expect(message.html).not.toContain('" onmouseover="');
  });

  it('should_escape_every_shop_supplied_string_too', () => {
    // Arrange: the owner is authenticated, not trusted with raw markup in a
    // message this product sends on their behalf.
    const booking = bookingWith({
      shopName: '<b>Shop</b>',
      locationName: '<i>Branch</i>',
      barberName: '<u>Nico</u>',
      serviceName: '<s>Corte</s>',
    });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.html).not.toContain('<b>');
    expect(message.html).not.toContain('<i>');
    expect(message.html).not.toContain('<u>');
    expect(message.html).not.toContain('<s>');
  });

  it('should_keep_control_characters_out_of_the_subject', () => {
    // Arrange: a CR/LF in a header is a second message with an attacker-chosen
    // recipient. The subject is the only header this builder composes.
    const booking = bookingWith({ shopName: 'Shop\r\nBcc: victim@example.com' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert: the property is that no control character survives — `Bcc:` as
    // ordinary text in a subject is inert, and asserting on it would be
    // asserting against a word rather than against the injection.
    expect(message.subject).not.toContain('\r');
    expect(message.subject).not.toContain('\n');
    expect(message.subject).toContain('Shop Bcc: victim@example.com');
  });

  it('should_keep_ordinary_punctuation_in_a_shop_name', () => {
    // Arrange: the control-character check must not become a range that eats
    // real punctuation — the exact way a literal control class misreads.
    const booking = bookingWith({ shopName: "Barbería #1 (Centro) - Corte & Co." });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.subject).toContain("Barbería #1 (Centro) - Corte & Co.");
  });

  it('should_compose_the_subject_from_the_shop_name_and_the_appointment', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.subject).toContain('Barbería Central');
    expect(message.subject).toContain('15:30');
  });

  it('should_not_carry_a_guest_supplied_name_into_the_subject', () => {
    // Arrange
    const booking = bookingWith({ clientName: 'ZZTOPSENTINEL' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.subject).not.toContain('ZZTOPSENTINEL');
  });

  it('should_address_the_message_to_the_client_email_and_nothing_else', () => {
    // Arrange
    const booking = bookingWith({ clientEmail: 'ana@example.com' });

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.to).toBe('ana@example.com');
  });
});

describe('buildBookingConfirmationEmail - what it must never contain', () => {
  it('should_reference_no_remote_host', () => {
    // Arrange: remote images are blocked by default in most clients, and a
    // tracking pixel is a privacy decision nobody made.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.html).not.toMatch(/<img\b/i);
    expect(message.html).not.toMatch(/<link\b/i);
    expect(message.html).not.toMatch(/<script\b/i);
    expect(message.html).not.toMatch(/url\(\s*https?:/i);
    // The only absolute URL permitted is this deployment's own booking link.
    const absolute = message.html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    expect(absolute.every((url) => url.startsWith(ORIGIN))).toBe(true);
  });

  it('should_carry_no_phone_number_field', () => {
    // Arrange: the projection does not select it, and the builder has no field
    // that could hold it. This asserts the type-level fact at runtime.
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(Object.keys(booking)).not.toContain('clientPhone');
    expect(message.text).not.toMatch(/\+54/);
  });

  it('should_produce_a_plain_text_part_free_of_markup', () => {
    // Arrange
    const booking = bookingWith();

    // Act
    const message = buildBookingConfirmationEmail({ booking, origin: ORIGIN });

    // Assert
    expect(message.text).not.toMatch(/<[a-z][^>]*>/i);
  });
});
