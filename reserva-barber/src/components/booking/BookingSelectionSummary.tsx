import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import type { BookingSelection } from '@/server/application/booking/bookingSelectionParams';

interface BookingSelectionSummaryProps {
  slug: string;
  selection: BookingSelection;
  /** A lone branch is still shown — it just is not offered as a choice. */
  hasBranchChoice: boolean;
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
}: BookingSelectionSummaryProps) {
  const { location, service } = selection;

  if (location === undefined) return null;

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
                href={bookingStepHref(slug, { locationId: location.location.id })}
                className="text-primary shrink-0 underline"
              >
                {COPY.booking.change}
              </StepLink>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
