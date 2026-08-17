import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import type { PublicBookingCatalog } from '@/server/domain/models/BookingCatalog';

interface LocationStepProps {
  slug: string;
  catalog: PublicBookingCatalog;
}

/**
 * The branch step.
 *
 * Every location here is offerable by construction — the catalogue contains no
 * branch without a bookable service (`buildBookingCatalog`). So this component
 * has no filtering to do and no "not available" state to render: a branch a
 * client cannot book at is absent, not disabled.
 *
 * An empty catalogue means the shop has nothing bookable anywhere. That is a
 * real state minutes after an owner's first save, so it gets a designed page
 * rather than an empty list — and it says nothing about *why*, because
 * deactivated, never created and unassigned are indistinguishable to the person
 * reading it.
 *
 * Options are links, not buttons: navigation works before hydration, each step
 * is shareable, and the browser's back button does the right thing without any
 * client-side state.
 */
export function LocationStep({ slug, catalog }: LocationStepProps) {
  if (catalog.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-medium">{COPY.booking.emptyShop}</h2>
        <p className="text-muted-foreground">{COPY.booking.emptyShopHelp}</p>
      </div>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-xl font-medium">{COPY.booking.locationHeading}</h2>

      <ul className="flex flex-col gap-2">
        {catalog.map(({ location }) => (
          <li key={location.id}>
            <StepLink
              href={bookingStepHref(slug, { locationId: location.id })}
              className="border-border hover:bg-accent focus-visible:ring-ring block w-full rounded-md border p-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              {/* `min-w-0` plus `break-words`: the column allows 120 characters
                  and a single unbroken one overflows a 360px viewport without
                  both. T18 records this reaching production once already. */}
              <span className="block min-w-0 font-medium break-words">{location.name}</span>
              {location.address !== null && (
                <span className="text-muted-foreground block min-w-0 text-sm break-words">
                  {location.address}
                </span>
              )}
            </StepLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
