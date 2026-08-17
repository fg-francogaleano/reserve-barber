import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import type { BookingSelection } from '@/server/application/booking/bookingSelectionParams';
import {
  formatLocalDate,
  formatSlotTime,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { formatBookingDateLong } from '@/lib/formatBookingDate';

interface BookingSelectionSummaryProps {
  slug: string;
  selection: BookingSelection;
  /** A lone branch is still shown — it just is not offered as a choice. */
  hasBranchChoice: boolean;
  /** The chosen day, once there is one. */
  date?: LocalDate | undefined;
  /** The chosen start, once there is one. */
  slot?: Date | undefined;
}

/**
 * What the client has chosen so far, with every entry changeable.
 *
 * This is what makes the skipped branch step safe (design D13): a shop's only
 * branch is named here rather than hidden, so a client at a two-branch shop that
 * became a one-branch shop still sees where they are being sent. When the branch
 * is not a choice it is shown without a change link, because there is nothing to
 * change it to.
 *
 * Rendered as a description list rather than a paragraph: each entry is a
 * label/value pair, and that is what a screen reader should hear.
 */
export function BookingSelectionSummary({
  slug,
  selection,
  hasBranchChoice,
  date,
  slot,
}: BookingSelectionSummaryProps) {
  const { location, service, barber } = selection;

  if (location === undefined) return null;

  const locationId = location.location.id;
  const serviceId = service?.service.id;
  const barberId = barber?.id;

  return (
    <section aria-label={COPY.booking.summaryHeading} className="bg-muted/50 w-full rounded-md p-3">
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground shrink-0">{COPY.booking.steps.location}</dt>
          <dd className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 font-medium break-words">{location.location.name}</span>
            {hasBranchChoice && (
              <StepLink href={bookingStepHref(slug)} className="text-primary shrink-0 underline">
                {COPY.booking.change}
              </StepLink>
            )}
          </dd>
        </div>

        {service !== undefined && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground shrink-0">{COPY.booking.steps.service}</dt>
            <dd className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 font-medium break-words">{service.service.name}</span>
              {/* Changing the service keeps the branch and drops the barber —
                  `bookingStepHref` omits the downstream key rather than
                  emitting one the resolver would discard a moment later. */}
              <StepLink
                href={bookingStepHref(slug, { locationId })}
                className="text-primary shrink-0 underline"
              >
                {COPY.booking.change}
              </StepLink>
            </dd>
          </div>
        )}

        {barber !== undefined && serviceId !== undefined && (
          <SummaryRow
            label={COPY.booking.steps.barber}
            value={barber.displayName}
            changeHref={bookingStepHref(slug, { locationId, serviceId })}
          />
        )}

        {date !== undefined && serviceId !== undefined && barberId !== undefined && (
          <SummaryRow
            label={COPY.booking.steps.date}
            value={formatBookingDateLong(date)}
            changeHref={bookingStepHref(slug, { locationId, serviceId, barberId })}
          />
        )}

        {slot !== undefined &&
          serviceId !== undefined &&
          barberId !== undefined &&
          date !== undefined && (
            <SummaryRow
              label={COPY.booking.steps.slot}
              value={formatSlotTime(slot)}
              changeHref={bookingStepHref(slug, {
                locationId,
                serviceId,
                barberId,
                date: formatLocalDate(date),
              })}
            />
          )}
      </dl>
    </section>
  );
}

/**
 * One label/value pair with its change link.
 *
 * Extracted when B3 took the summary from two rows to five: the branch row keeps
 * its own shape because it is the one entry that can appear without a change
 * link at all.
 */
function SummaryRow({
  label,
  value,
  changeHref,
}: {
  label: string;
  value: string;
  changeHref: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 font-medium break-words">{value}</span>
        <StepLink href={changeHref} className="text-primary shrink-0 underline">
          {COPY.booking.change}
        </StepLink>
      </dd>
    </div>
  );
}
