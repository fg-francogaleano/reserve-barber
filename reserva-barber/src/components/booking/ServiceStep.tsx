import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { formatAmount } from '@/server/domain/models/money';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import type { BookableLocation } from '@/server/domain/models/BookingCatalog';

interface ServiceStepProps {
  slug: string;
  location: BookableLocation;
  hasBranchChoice: boolean;
}

/**
 * The service step, scoped to the chosen branch.
 *
 * `location.services` is already the bookable set **for this branch** — that is
 * the whole point of the (service, location) unit (design D4). A service
 * performed only at another branch is absent here, not greyed out, because a
 * client cannot act on knowing it exists somewhere else.
 *
 * The price goes through `formatAmount`, the inverse of the parser the owner's
 * editor uses. It is the only path a price may take to a screen: both M3 and PC3
 * measured what happens when a driver decimal escapes, and this is the first
 * surface in the product where the number is read by someone about to pay it.
 */
export function ServiceStep({ slug, location, hasBranchChoice }: ServiceStepProps) {
  if (location.services.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-medium">{COPY.booking.emptyServices}</h2>
        {hasBranchChoice && (
          <>
            <p className="text-muted-foreground">{COPY.booking.emptyServicesHelp}</p>
            <StepLink href={bookingStepHref(slug)} className="text-primary underline">
              {COPY.booking.back}
            </StepLink>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-xl font-medium">{COPY.booking.serviceHeading}</h2>

      <ul className="flex flex-col gap-2">
        {location.services.map(({ service }) => (
          <li key={service.id}>
            <StepLink
              href={bookingStepHref(slug, {
                locationId: location.location.id,
                serviceId: service.id,
              })}
              className="border-border hover:bg-accent focus-visible:ring-ring block w-full rounded-md border p-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-medium break-words">{service.name}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {COPY.booking.price(formatAmount(service.price))}
                </span>
              </span>
              <span className="text-muted-foreground block text-sm">
                {COPY.booking.duration(service.durationMinutes)}
              </span>
              {service.description !== null && (
                <span className="text-muted-foreground block min-w-0 text-sm break-words">
                  {service.description}
                </span>
              )}
            </StepLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
