import { COPY } from '@/lib/copy';
import { BookingSubmitButton } from './BookingSubmitButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatLocalDate, type LocalDate } from '@/server/domain/models/bookingCalendar';
import type { BookingFieldErrors } from '@/server/application/booking/bookingRequestSchema';

interface ClientDetailsStepProps {
  slug: string;
  locationId: string;
  serviceId: string;
  barberId: string;
  date: LocalDate;
  /** `HH:mm`, exactly as the slot list rendered it. */
  time: string;
  /** Canonical decimal string, already computed by the deposit rule. */
  depositAmount: string;
  /** Field errors echoed back from a rejected submission, if any. */
  fieldErrors?: BookingFieldErrors | undefined;
  /** What the client typed, preserved across a rejection. */
  submitted?: { name?: string; email?: string; phone?: string } | undefined;
}

const FIELD_MESSAGES: Record<string, string> = {
  'name:required': COPY.booking.nameRequired,
  'name:too_short': COPY.booking.nameTooShort,
  'name:too_long': COPY.booking.nameTooLong,
  'email:required': COPY.booking.emailRequired,
  'email:invalid_email': COPY.booking.emailInvalid,
  'email:too_long': COPY.booking.emailTooLong,
  'phone:required': COPY.booking.phoneRequired,
  'phone:invalid_phone': COPY.booking.phoneInvalid,
  'phone:too_long': COPY.booking.phoneInvalid,
};

function messageFor(field: 'name' | 'email' | 'phone', code: string | undefined): string | null {
  if (code === undefined) return null;
  return FIELD_MESSAGES[`${field}:${code}`] ?? null;
}

/**
 * The last step: three fields and the amount they commit to.
 *
 * **A native form posting to a Route Handler**, not a Server Action. That is a
 * hard rule for this flow (`backend-standards.md`): a Server Action is
 * addressed by a build-time id, and a guest mid-checkout is exactly who must
 * never meet one the server no longer recognizes. It is also what makes the
 * no-JavaScript path work — the handler answers `303` with an outcome code and
 * the page re-renders the error from the URL, with no client action state
 * involved.
 *
 * **`required` is the only validation attribute.** No `pattern`, no `minlength`,
 * no `type="tel"` constraint: each would let the browser block the submission
 * with a message in the browser's locale from a string that exists in no copy
 * module, so the validation the client meets would not be the validation the
 * specification describes, and the server rule would never run.
 *
 * The deposit sits **above** the fields deliberately. The client is about to
 * hand over contact details, and the amount they will owe is what they are
 * consenting to — putting it under the submit button would disclose the price
 * after the decision.
 */
export function ClientDetailsStep({
  slug,
  locationId,
  serviceId,
  barberId,
  date,
  time,
  depositAmount,
  fieldErrors,
  submitted,
}: ClientDetailsStepProps) {
  const nameError = messageFor('name', fieldErrors?.name);
  const emailError = messageFor('email', fieldErrors?.email);
  const phoneError = messageFor('phone', fieldErrors?.phone);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">{COPY.booking.datosHeading}</h2>

      <div className="border-border bg-muted/50 flex flex-col gap-1 rounded-md border p-4">
        <p className="text-muted-foreground text-sm">{COPY.booking.depositLabel}</p>
        <p className="text-xl font-semibold break-words">{formatCurrency(depositAmount)}</p>
        <p className="text-muted-foreground text-sm">{COPY.booking.depositHelp}</p>
      </div>

      <form method="post" action="/api/bookings" className="flex flex-col gap-4">
        {/* The selection as the page resolved it. Every one of these is
            re-verified server-side — a hidden input is a rendering of state,
            not a claim about it. */}
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="serviceId" value={serviceId} />
        <input type="hidden" name="barberId" value={barberId} />
        <input type="hidden" name="fecha" value={formatLocalDate(date)} />
        <input type="hidden" name="hora" value={time} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="booking-name">{COPY.booking.nameLabel}</Label>
          <Input
            id="booking-name"
            name="name"
            required
            autoComplete="name"
            defaultValue={submitted?.name ?? ''}
            {...(nameError !== null && {
              'aria-invalid': true,
              'aria-describedby': 'booking-name-error',
            })}
          />
          {nameError !== null && (
            <p id="booking-name-error" role="alert" className="text-destructive text-sm">
              {nameError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="booking-email">{COPY.booking.emailLabel}</Label>
          <Input
            id="booking-email"
            name="email"
            // `type="email"` is safe where `pattern` is not: it raises the right
            // keyboard on touch devices and its own constraint is a superset of
            // what the server rejects, so no submission the server would accept
            // is blocked by the browser in its own locale.
            type="email"
            required
            autoComplete="email"
            defaultValue={submitted?.email ?? ''}
            {...(emailError !== null && {
              'aria-invalid': true,
              'aria-describedby': 'booking-email-error',
            })}
          />
          <p className="text-muted-foreground text-sm">{COPY.booking.emailHelp}</p>
          {emailError !== null && (
            <p id="booking-email-error" role="alert" className="text-destructive text-sm">
              {emailError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="booking-phone">{COPY.booking.phoneLabel}</Label>
          <Input
            id="booking-phone"
            name="phone"
            // `type="text"` with `inputMode="tel"`, never `type="tel"` with a
            // pattern: the numeric keypad is the whole benefit, and the parsing
            // is the server's job — it accepts +54, a leading 0, a 15 marker and
            // any separators.
            type="text"
            inputMode="tel"
            required
            autoComplete="tel"
            defaultValue={submitted?.phone ?? ''}
            {...(phoneError !== null && {
              'aria-invalid': true,
              'aria-describedby': 'booking-phone-error',
            })}
          />
          <p className="text-muted-foreground text-sm">{COPY.booking.phoneHelp}</p>
          {phoneError !== null && (
            <p id="booking-phone-error" role="alert" className="text-destructive text-sm">
              {phoneError}
            </p>
          )}
        </div>

        <BookingSubmitButton />
      </form>
    </section>
  );
}
