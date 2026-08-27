import { describe, it, expect } from 'vitest';
import {
  buildBookingCancellationEmail,
  type CancellationEmailBooking,
} from './bookingCancellationEmail';

/** 15:30 business-local on Sunday 30 August 2026 (UTC-3, no DST in Argentina). */
const START = new Date('2026-08-30T18:30:00.000Z');

function bookingWith(overrides: Partial<CancellationEmailBooking> = {}): CancellationEmailBooking {
  return {
    clientName: 'Ana Pérez',
    clientEmail: 'ana@example.com',
    shopName: 'Barbería Central',
    locationName: 'Sucursal Palermo',
    barberName: 'Nico',
    serviceName: 'Corte y barba',
    startTime: START,
    depositAmount: '2000.50',
    ...overrides,
  };
}

function build(overrides: Partial<CancellationEmailBooking> = {}, depositApproved = false) {
  return buildBookingCancellationEmail({ booking: bookingWith(overrides), depositApproved });
}

describe('buildBookingCancellationEmail - what it says', () => {
  it('should_name_the_shop_as_the_canceller_and_never_an_expiry', () => {
    // Act
    const message = build();

    // Assert: the whole point. "Venció" blames the client for running out of
    // time, when in fact somebody decided.
    expect(message.text).toContain('canceló tu turno');
    expect(message.text).not.toMatch(/venci|expir/i);
  });

  it('should_render_the_cancelled_appointment_in_the_business_timezone', () => {
    // Act
    const message = build();

    // Assert
    expect(message.text).toContain('15:30');
    expect(message.text).not.toContain('18:30');
    expect(message.text).toContain('domingo, 30 de agosto');
  });

  it('should_name_the_branch_the_barber_and_the_service', () => {
    // Act
    const message = build();

    // Assert
    for (const part of [message.text, message.html]) {
      expect(part).toContain('Sucursal Palermo');
      expect(part).toContain('Nico');
      expect(part).toContain('Corte y barba');
    }
  });

  it('should_compose_the_subject_from_server_held_values_only', () => {
    // Act
    const message = build({ clientName: 'ZZTOPSENTINEL' });

    // Assert
    expect(message.subject).toContain('Barbería Central');
    expect(message.subject).toContain('15:30');
    expect(message.subject).not.toContain('ZZTOPSENTINEL');
  });
});

describe('buildBookingCancellationEmail - the money', () => {
  it('should_state_that_an_approved_deposit_is_not_returned_here', () => {
    // Act
    const message = build({}, true);

    // Assert
    expect(message.text).toContain('2.000,50');
    expect(message.text).toMatch(/no se devuelve por este sistema/);
  });

  it('should_say_nothing_about_money_when_no_deposit_was_approved', () => {
    // Arrange: mentioning a deposit nobody paid invites a client to ask for a
    // refund of something that never left their account.
    const message = build({}, false);

    // Assert
    expect(message.text).not.toContain('2.000,50');
    expect(message.text).not.toMatch(/devolución|devuelve/i);
  });

  it('should_render_the_deposit_from_the_canonical_string_the_driver_truncates', () => {
    // Arrange: a stored 2000.50 arrives as "2000.5"; reading the lone 5 as five
    // centavos is the PC3 defect, permanent in a message once sent.
    const message = build({ depositAmount: '2000.5' }, true);

    // Assert
    expect(message.text).toContain('2.000,50');
    expect(message.text).not.toContain('2.000,05');
  });
});

describe('buildBookingCancellationEmail - what it must never contain', () => {
  /**
   * A cancelled booking has nothing for its client to do on the page, and the
   * link is a cancellation token — a credential (T69). Sending it where it has
   * no use is strictly worse than not sending it, and the builder's own input
   * type has no field that could carry one.
   */
  it('should_carry_no_link_and_no_token', () => {
    // Act
    const message = build();

    // Assert
    expect(message.text).not.toMatch(/https?:/);
    expect(message.html).not.toMatch(/<a\b/i);
    expect(message.text).not.toContain('/reserva/');
  });

  it('should_offer_no_way_to_pay', () => {
    // Act
    const message = build({}, true);

    // Assert
    expect(message.text).not.toMatch(/pagar|abonar|seguir con el pago/i);
  });

  it('should_reference_no_remote_host', () => {
    // Act
    const message = build();

    // Assert
    expect(message.html).not.toMatch(/<img\b|<link\b|<script\b/i);
  });

  it('should_produce_a_plain_text_part_free_of_markup', () => {
    // Act
    const message = build();

    // Assert
    expect(message.text).not.toMatch(/<[a-z][^>]*>/i);
  });
});

describe('buildBookingCancellationEmail - guest-supplied values', () => {
  it('should_escape_markup_in_the_client_name', () => {
    // Act
    const message = build({ clientName: '<img src=x onerror=alert(1)>' });

    // Assert
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });

  it('should_escape_a_name_that_tries_to_close_an_attribute', () => {
    // Act
    const message = build({ clientName: '" onmouseover="x' });

    // Assert
    expect(message.html).toContain('&quot;');
    expect(message.html).not.toContain('" onmouseover="');
  });

  it('should_keep_control_characters_out_of_the_subject', () => {
    // Arrange: a CR/LF in a header is a second message with an attacker-chosen
    // recipient. The subject is the only header this builder composes.
    const message = build({ shopName: 'Shop\r\nBcc: victim@example.com' });

    // Assert
    expect(message.subject).not.toContain('\r');
    expect(message.subject).not.toContain('\n');
  });

  it('should_keep_ordinary_punctuation_in_a_shop_name', () => {
    // Act
    const message = build({ shopName: "Barbería #1 (Centro) - Corte & Co." });

    // Assert
    expect(message.subject).toContain("Barbería #1 (Centro) - Corte & Co.");
  });

  it('should_address_the_message_to_the_client_and_nobody_else', () => {
    // Act
    const message = build();

    // Assert
    expect(message.to).toBe('ana@example.com');
  });
});
