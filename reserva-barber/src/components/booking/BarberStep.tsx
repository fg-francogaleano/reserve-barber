import { StepLink } from './StepLink';
import { COPY } from '@/lib/copy';
import { initialsFrom } from './ProfileHeader';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import type { BookableLocation, BookableService } from '@/server/domain/models/BookingCatalog';

interface BarberStepProps {
  slug: string;
  location: BookableLocation;
  service: BookableService;
}

/**
 * The barber step, scoped to the chosen service **at the chosen branch**.
 *
 * `service.barbers` is non-empty by construction, so the empty state below is
 * reachable only through a race: the last assignment was removed between the
 * catalogue read and this render, or — far more likely — the client is holding a
 * link built before it was. It is written for that case and says nothing about
 * the cause.
 *
 * Avatars are plain `<img>` with fixed dimensions and an initials fallback, the
 * same treatment and the same reasoning as `ProfileHeader` (B1 design D1): no
 * remote pattern is configured, OpenNext on `workerd` does not run the
 * optimizer, and P1 already shrinks images before upload. Reserving the space is
 * what keeps the list from reflowing under a thumb as avatars resolve.
 */
export function BarberStep({ slug, location, service }: BarberStepProps) {
  if (service.barbers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-medium">{COPY.booking.emptyBarbers}</h2>
        <p className="text-muted-foreground">{COPY.booking.emptyBarbersHelp}</p>
        <StepLink
          href={bookingStepHref(slug, { locationId: location.location.id })}
          className="text-primary underline"
        >
          {COPY.booking.back}
        </StepLink>
      </div>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-xl font-medium">{COPY.booking.barberHeading}</h2>

      <ul className="flex flex-col gap-2">
        {service.barbers.map((barber) => (
          <li key={barber.id}>
            <StepLink
              href={bookingStepHref(slug, {
                locationId: location.location.id,
                serviceId: service.service.id,
                barberId: barber.id,
              })}
              className="border-border hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-md border p-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-secondary text-secondary-foreground flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold">
                {barber.avatarUrl === null ? (
                  <span aria-hidden="true">{initialsFrom(barber.displayName)}</span>
                ) : (
                  // Plain `<img>` on purpose — see the component comment above.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={barber.avatarUrl}
                    alt={COPY.booking.barberAvatarAlt(barber.displayName)}
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </span>

              <span className="flex min-w-0 flex-col">
                <span className="min-w-0 font-medium break-words">{barber.displayName}</span>
                {barber.bio !== null && (
                  <span className="text-muted-foreground min-w-0 text-sm break-words">
                    {barber.bio}
                  </span>
                )}
              </span>
            </StepLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
