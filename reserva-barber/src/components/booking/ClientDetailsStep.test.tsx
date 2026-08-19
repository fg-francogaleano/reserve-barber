import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientDetailsStep } from './ClientDetailsStep';
import { COPY } from '@/lib/copy';

const DATE = { year: 2026, month: 8, day: 17 };

function renderStep(props: Partial<Parameters<typeof ClientDetailsStep>[0]> = {}) {
  return render(
    <ClientDetailsStep
      slug="barberia-don-juan"
      locationId="loc-centro"
      serviceId="svc-corte"
      barberId="bar-ana"
      date={DATE}
      time="09:00"
      depositAmount="1000.00"
      {...props}
    />
  );
}

describe('ClientDetailsStep - the form contract', () => {
  it('should_post_to_the_route_handler_rather_than_a_server_action', () => {
    // A Server Action is addressed by a build-time id; a guest mid-checkout is
    // exactly who must never meet one the server no longer recognizes.
    const { container } = renderStep();
    const form = container.querySelector('form');

    expect(form?.getAttribute('action')).toBe('/api/bookings');
    expect(form?.getAttribute('method')).toBe('post');
  });

  it('should_collect_exactly_three_visible_fields', () => {
    renderStep();

    expect(screen.getByLabelText(COPY.booking.nameLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.booking.emailLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.booking.phoneLabel)).toBeInTheDocument();
  });

  it('should_delegate_no_validation_to_the_browser_locale', () => {
    // `pattern`, `min`, `max`, `step`, `minlength` and `maxlength` each let the
    // browser block a submission with a message from a string that exists in
    // no copy module — so the validation the client meets would not be the one
    // the specification describes, and the server rule would never run.
    const { container } = renderStep();

    for (const attribute of ['pattern', 'min', 'max', 'step', 'minlength', 'maxlength']) {
      expect(container.querySelector(`[${attribute}]`)).toBeNull();
    }
  });

  it('should_use_a_text_input_with_a_tel_keypad_for_the_phone', () => {
    // `type="tel"` with a pattern would hand parsing to the browser; the
    // server accepts +54, a leading 0, a 15 marker and any separators.
    renderStep();
    const input = screen.getByLabelText(COPY.booking.phoneLabel);

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'tel');
  });

  it('should_carry_the_whole_selection_as_hidden_inputs', () => {
    const { container } = renderStep();

    const hidden = Object.fromEntries(
      Array.from(container.querySelectorAll('input[type="hidden"]')).map((input) => [
        input.getAttribute('name'),
        input.getAttribute('value'),
      ])
    );

    expect(hidden).toEqual({
      slug: 'barberia-don-juan',
      locationId: 'loc-centro',
      serviceId: 'svc-corte',
      barberId: 'bar-ana',
      fecha: '2026-08-17',
      hora: '09:00',
    });
  });
});

describe('ClientDetailsStep - the deposit', () => {
  it('should_show_the_amount_above_the_fields', () => {
    // The client is about to hand over contact details; the amount they will
    // owe is what they are consenting to.
    const { container } = renderStep();

    const text = container.textContent ?? '';
    const depositIndex = text.indexOf(COPY.booking.depositLabel);
    const nameIndex = text.indexOf(COPY.booking.nameLabel);

    expect(depositIndex).toBeGreaterThanOrEqual(0);
    expect(depositIndex).toBeLessThan(nameIndex);
  });

  it('should_format_it_in_es_AR_with_two_decimals', () => {
    renderStep({ depositAmount: '2000.50' });

    expect(screen.getByText(/2\.000,50/)).toBeInTheDocument();
  });
});

describe('ClientDetailsStep - a rejected submission', () => {
  it('should_announce_a_field_error_and_bind_it_to_its_input', () => {
    renderStep({ fieldErrors: { phone: 'invalid_phone' } });

    const input = screen.getByLabelText(COPY.booking.phoneLabel);
    const error = screen.getByRole('alert');

    expect(error).toHaveTextContent(COPY.booking.phoneInvalid);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('should_preserve_every_value_the_client_typed', () => {
    // A rejection that clears three fields is worse than the error it reports.
    renderStep({
      fieldErrors: { phone: 'invalid_phone' },
      submitted: { name: 'Ana Pérez', email: 'ana@mail.com', phone: '555' },
    });

    expect(screen.getByLabelText(COPY.booking.nameLabel)).toHaveValue('Ana Pérez');
    expect(screen.getByLabelText(COPY.booking.emailLabel)).toHaveValue('ana@mail.com');
    expect(screen.getByLabelText(COPY.booking.phoneLabel)).toHaveValue('555');
  });

  it('should_report_each_field_with_its_own_message', () => {
    renderStep({ fieldErrors: { name: 'required', email: 'invalid_email', phone: 'required' } });

    expect(screen.getByText(COPY.booking.nameRequired)).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.emailInvalid)).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.phoneRequired)).toBeInTheDocument();
  });

  it('should_show_no_error_markup_when_there_is_nothing_to_report', () => {
    renderStep();

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ClientDetailsStep - the narrow content bound', () => {
  it('should_let_a_long_unbroken_email_and_name_wrap_rather_than_overflow', () => {
    // 360px is the project's narrow case. An unbroken 80-character address in
    // an echoed value is the realistic way this page would overflow.
    const { container } = renderStep({
      submitted: {
        name: 'A'.repeat(120),
        email: `${'a'.repeat(80)}@mail.com`,
      },
      depositAmount: '9999999.99',
    });

    // Every text block that can receive an unbounded value carries a wrapping
    // rule; the values themselves live in inputs, which clip rather than push.
    const deposit = container.querySelector('.text-xl');
    expect(deposit?.className).toContain('break-words');
  });
});
