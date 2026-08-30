import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBookingReminderEmail } from './bookingReminderEmail';
import type { ReminderEmailBooking } from './bookingReminderEmail';
import { COPY } from '@/lib/copy';

const ORIGIN = 'https://reservabarber.com';

function booking(overrides: Partial<ReminderEmailBooking> = {}): ReminderEmailBooking {
  return {
    clientName: 'Ana Pérez',
    clientEmail: 'ana@example.com',
    shopName: 'Barbería Central',
    shopSlug: 'barberia-central',
    locationName: 'Sucursal Palermo',
    locationAddress: 'Gorriti 4500',
    barberName: 'Nico',
    serviceName: 'Corte y barba',
    // 2026-08-30 08:00 in the business timezone (UTC-3).
    startTime: new Date('2026-08-30T11:00:00.000Z'),
    priceAtBooking: '9000.00',
    depositAmount: '2000.50',
    cancellationToken: 'tok-abc123',
    ...overrides,
  };
}

describe('buildBookingReminderEmail - the appointment', () => {
  it('should_render_the_date_and_time_in_the_business_timezone', () => {
    // Never the runtime's zone and never the recipient's. Through the shared
    // calendar module, because a second expression of a rule that reads a clock
    // drifts from the first.
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text).toContain('08:00');
    expect(message.text).not.toContain('11:00');
  });

  it('should_state_the_deposit_paid_and_the_balance_owed', () => {
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text).toContain(COPY.email.reminder.depositLabel);
    expect(message.text).toContain(COPY.email.reminder.balanceLabel);
    // 9000.00 - 2000.50, in integer cents. In binary floating point the same
    // subtraction is 6999.499999999999, printed in a message nobody can correct.
    expect(message.text).toMatch(/6\.?999,50/);
  });

  it('should_omit_the_balance_line_entirely_when_nothing_is_left_to_pay', () => {
    // "$ 0,00 a pagar en el local" reads as a mistake rather than as good news.
    const message = buildBookingReminderEmail({
      booking: booking({ priceAtBooking: '9000.00', depositAmount: '9000.00' }),
      origin: ORIGIN,
    });

    expect(message.text).not.toContain(COPY.email.reminder.balanceLabel);
  });

  it('should_omit_the_address_line_when_the_location_has_none', () => {
    const message = buildBookingReminderEmail({
      booking: booking({ locationAddress: null }),
      origin: ORIGIN,
    });

    expect(message.text).not.toContain(COPY.email.reminder.addressLabel);
  });
});

describe('buildBookingReminderEmail - the link', () => {
  it('should_address_the_booking_page_by_the_cancellation_token', () => {
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text).toContain(`${ORIGIN}/b/barberia-central/reserva/tok-abc123`);
  });

  it('should_lead_with_cancelling_because_that_is_what_this_message_is_for', () => {
    // The confirmation offers the page for seeing OR cancelling, because at
    // that moment seeing is what the client wants. A day out, the useful action
    // is releasing a slot the shop can still sell.
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text).toContain(COPY.email.reminder.linkIntro);
    expect(COPY.email.reminder.linkIntro.toLowerCase()).toMatch(/liberar|cancel/);
  });

  it('should_print_the_complete_url_as_readable_text_in_the_plain_part', () => {
    // Where a link rendered only as a styled control disappears: a forward, a
    // client that strips markup, a plain-text render.
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    const url = `${ORIGIN}/b/barberia-central/reserva/tok-abc123`;
    expect(message.text.split('\n')).toContain(url);
  });

  it('should_print_the_url_twice_in_the_markup_as_control_and_as_text', () => {
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    const url = `${ORIGIN}/b/barberia-central/reserva/tok-abc123`;
    expect(message.html.split(url).length - 1).toBe(2);
  });

  it('should_send_with_no_url_at_all_when_no_origin_resolves', () => {
    // A client is still better off knowing. It never emits a relative URL or a
    // loopback address, because a message cannot be redeployed.
    const message = buildBookingReminderEmail({ booking: booking(), origin: null });

    expect(message.text).toContain(COPY.email.reminder.noLink);
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.html).not.toMatch(/href=/);
  });

  it('should_percent_encode_the_slug_and_the_token_into_the_url', () => {
    const message = buildBookingReminderEmail({
      booking: booking({ shopSlug: 'a b', cancellationToken: 'x/y' }),
      origin: ORIGIN,
    });

    expect(message.text).toContain(`${ORIGIN}/b/a%20b/reserva/x%2Fy`);
  });
});

describe('buildBookingReminderEmail - hostile guest values', () => {
  it('should_escape_a_client_name_containing_markup', () => {
    const message = buildBookingReminderEmail({
      booking: booking({ clientName: '<script>alert(1)</script>' }),
      origin: ORIGIN,
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('should_keep_a_client_name_containing_crlf_out_of_every_header', () => {
    // A newline in a header is a second message with an attacker-chosen
    // recipient. The name does not belong in a header at all; this asserts the
    // outcome rather than the mechanism.
    const message = buildBookingReminderEmail({
      booking: booking({ clientName: 'Ana\r\nBcc: victim@example.com' }),
      origin: ORIGIN,
    });

    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject).not.toContain('victim@example.com');
    expect(message.to).toBe('ana@example.com');
  });

  it('should_compose_the_subject_from_server_held_values_only', () => {
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.subject).toContain('Barbería Central');
    expect(message.subject).not.toContain('Ana Pérez');
  });

  it('should_strip_newlines_a_shop_name_carries_into_the_subject', () => {
    // Owner-supplied rather than guest-supplied, but it reaches a header, and a
    // header is a header.
    const message = buildBookingReminderEmail({
      booking: booking({ shopName: 'Barbería\r\nX' }),
      origin: ORIGIN,
    });

    expect(message.subject).not.toMatch(/[\r\n]/);
  });
});

describe('buildBookingReminderEmail - what the message must not contain', () => {
  it('should_reference_no_remote_asset', () => {
    // A remote asset in an email is a tracking pixel whether or not anybody
    // meant it to be, and images are blocked by default in most clients.
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.html).not.toMatch(/<img/i);
    expect(message.html).not.toMatch(/<link/i);
    expect(message.html).not.toMatch(/url\(/i);
  });

  it('should_carry_a_plain_text_alternative_alongside_the_markup', () => {
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text.length).toBeGreaterThan(0);
    expect(message.text).not.toMatch(/<[a-z]/i);
  });

  it('should_say_the_appointment_needs_no_action', () => {
    // "Confirmá tu turno" would read as a booking that lapses if ignored, and
    // this one does not — the deposit already confirmed it.
    const message = buildBookingReminderEmail({ booking: booking(), origin: ORIGIN });

    expect(message.text).toContain(COPY.email.reminder.intro);
    expect(COPY.email.reminder.intro).toMatch(/no ten[eé]s que hacer nada/i);
  });

  it('should_never_name_a_day_it_cannot_know', () => {
    // **Found by the adversarial pass.** The intro read "Tu turno es mañana",
    // which is false whenever the message is not sent exactly one lead before
    // the appointment — and the window's near edge is deliberately open, as
    // `bookingReminder.test.ts` asserts. A booking due in ninety minutes would
    // have been told it was "mañana", and the client would plan around the
    // wrong day.
    //
    // Asserted on the copy string rather than on a rendered message, because
    // the defect is the sentence claiming something the sender cannot know.
    for (const line of [COPY.email.reminder.intro, COPY.email.reminder.heading]) {
      expect(line).not.toMatch(/mañana|hoy|pasado mañana/i);
    }
  });

  it('should_carry_the_appointment_day_only_where_it_is_computed', () => {
    // The date is right in exactly one place: the row built from `startTime`.
    const soon = new Date('2026-08-29T14:00:00.000Z');
    const message = buildBookingReminderEmail({
      booking: booking({ startTime: soon }),
      origin: ORIGIN,
    });

    expect(message.text).toContain(COPY.email.reminder.whenLabel);
    expect(message.text).toContain('11:00');
  });
});

describe('the confirmation builder is left alone', () => {
  it('should_take_no_message_kind_parameter', () => {
    // Two messages behind one boolean is how they become one confusable
    // message. The reminder is its own pure function; the confirmation keeps
    // the two-field input it has had since N1.
    const source = readFileSync(
      join(process.cwd(), 'src', 'server', 'domain', 'models', 'bookingConfirmationEmail.ts'),
      'utf8'
    );

    // Comments stripped before scanning. The first version of this test read
    // the whole file and failed on the sentence "no remote asset of any kind" —
    // a scan that cannot tell English prose from an identifier, which is the
    // third time in this change alone that shape has bitten, and the same
    // limitation D7 and B7 each recorded about their own scans.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bkind\b/);
    expect(code).not.toMatch(/\breminder\b/i);

    // And the scan must still be able to see the declaration, or it proves
    // nothing: the interface is the actual guarantee, the word checks are what
    // stop it being widened by a differently-named flag.
    expect(code).toMatch(/interface ConfirmationEmailInput \{[^}]*booking[^}]*origin[^}]*\}/);
    expect(code).toContain('export function buildBookingConfirmationEmail');
  });
});
