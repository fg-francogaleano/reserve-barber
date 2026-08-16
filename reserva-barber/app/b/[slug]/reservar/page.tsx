import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { StepLink } from '@/components/booking/StepLink';
import { BookingStepIndicator } from '@/components/booking/BookingStepIndicator';
import { BookingSelectionSummary } from '@/components/booking/BookingSelectionSummary';
import { LocationStep } from '@/components/booking/LocationStep';
import { ServiceStep } from '@/components/booking/ServiceStep';
import { BarberStep } from '@/components/booking/BarberStep';
import {
  bookingStepHref,
  hasBranchChoice,
  resolveBookingSelection,
  withImpliedBranch,
  type DiscardedSelection,
  type RawBookingSelection,
} from '@/server/application/booking/bookingSelectionParams';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { bookingCatalogService } from './bookingCatalogService';
import type { BookingCatalogResolution } from '@/server/application/services/PublicBookingCatalogService';

/**
 * Rendered per request, like every other page in this project.
 *
 * Here it carries more weight than on the profile page: the catalogue is exactly
 * what an owner changes between one client's visit and the next, and a cached
 * answer would offer a barber who stopped working there this morning.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawBookingSelection>;
}

/**
 * Every parameterized variant declares the **bare** path as canonical
 * (design D14).
 *
 * Left alone, this route generates one crawlable URL per (branch, service,
 * barber) combination per shop — near-duplicates competing with `/b/{slug}`,
 * which B1 made deliberately indexable because discovery is what the product is
 * for. `noindex` was the alternative and loses the entry point; a canonical
 * keeps it and collapses the parameter space onto it.
 *
 * It has to be `generateMetadata` rather than a static `metadata` export: the
 * slug is dynamic, and a static object cannot name the URL it is canonicalizing
 * to.
 *
 * **No database read happens here.** Unlike the profile page's metadata, this
 * needs nothing but the slug, so it adds no query to the route T47 is about —
 * and it cannot throw a mistyped slug into a 500 on the way to its 404.
 *
 * The origin comes from `APP_ORIGIN` or the absolute values are **omitted**,
 * exactly as B1 decided: on a public route the `Host` header is supplied by a
 * stranger, and feeding it into a canonical tag would have a shop declare
 * someone else's origin authoritative for its own booking page.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const origin = resolveOrigin({ configured: process.env.APP_ORIGIN });

  if (origin === null) return {};

  return {
    metadataBase: new URL(origin),
    alternates: { canonical: `/b/${slug}/reservar` },
  };
}

const STALE_NOTICE: Record<DiscardedSelection, string> = {
  location: COPY.booking.staleLocation,
  service: COPY.booking.staleService,
  barber: COPY.booking.staleBarber,
};

/**
 * Deliberately **no `loading.tsx` and no Suspense boundary above this**
 * (design D8).
 *
 * B1 measured it on the deployment runtime: a boundary makes Next commit
 * `200 OK` before the page resolves, which degrades `notFound()` to a soft 404
 * and `permanentRedirect()` to a `<meta http-equiv="refresh">`. WhatsApp and
 * Instagram follow HTTP redirects when building a link preview and do not
 * execute a meta refresh — on a product whose distribution channel is WhatsApp.
 * This route makes both calls, so it inherits the constraint whole.
 */
async function resolve(slug: string): Promise<BookingCatalogResolution> {
  try {
    return await bookingCatalogService().resolveBySlug(slug);
  } catch (error) {
    logger.error('Failed to resolve booking catalog', toErrorLogContext('resolveBySlug', error));
    throw error;
  }
}

export default async function BookingPage({ params, searchParams }: PageProps) {
  const { slug } = await params;

  // The shop is resolved before a single query parameter is looked at. Until it
  // resolves there is no owner, so there is nothing any of those ids could be
  // checked against — and checking them later, against a catalogue, is the only
  // thing that makes one real.
  const resolution = await resolve(slug);

  if (resolution.type === 'notFound') {
    notFound();
  }

  if (resolution.type === 'redirect') {
    // The query string travels with the redirect (design D9). Dropping it would
    // discard the client's selection during a redirect they never asked for, and
    // the page would appear to lose their input. 308 rather than 302 because it
    // is method-preserving, and B4 posts to this path.
    const raw = await searchParams;
    permanentRedirect(
      bookingStepHref(resolution.canonicalSlug, {
        locationId: firstValue(raw.local),
        serviceId: firstValue(raw.servicio),
        barberId: firstValue(raw.barbero),
      })
    );
  }

  const { catalog } = resolution;
  const branchChoice = hasBranchChoice(catalog);
  const { step, selection, discarded } = withImpliedBranch(
    catalog,
    resolveBookingSelection(catalog, await searchParams)
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{COPY.booking.heading}</h1>

      {catalog.length > 0 && <BookingStepIndicator current={step} hasBranchChoice={branchChoice} />}

      {/* A link that outlived the catalogue it was built from is the ordinary
          case here, not the exceptional one. The client is told what stopped
          working and never why — the system cannot tell deactivated from deleted
          either, and the owner did not agree to publish which it was. */}
      {discarded.map((what) => (
        <p
          key={what}
          role="status"
          className="border-border bg-muted/50 text-muted-foreground rounded-md border p-3 text-sm"
        >
          {STALE_NOTICE[what]}
        </p>
      ))}

      <BookingSelectionSummary slug={slug} selection={selection} hasBranchChoice={branchChoice} />

      {step === 'location' && <LocationStep slug={slug} catalog={catalog} />}

      {step === 'service' && selection.location !== undefined && (
        <ServiceStep slug={slug} location={selection.location} hasBranchChoice={branchChoice} />
      )}

      {(step === 'barber' || step === 'complete') &&
        selection.location !== undefined &&
        selection.service !== undefined && (
          <BarberStep slug={slug} location={selection.location} service={selection.service} />
        )}

      {/* B3 turns the completed triple into a date and a time. Until it ships
          the flow says so plainly rather than ending on a control that goes
          nowhere — the same disclosure P1 made for an unresolvable link and B1
          made for this very button one story ago. */}
      {step === 'complete' && (
        <p className="text-muted-foreground text-center text-sm">
          {COPY.booking.continueUnavailable}
        </p>
      )}

      {step !== 'location' && branchChoice && (
        <StepLink href={bookingStepHref(slug)} className="text-primary text-sm underline">
          {COPY.booking.back}
        </StepLink>
      )}
    </main>
  );
}

/** A repeated parameter keeps its first value across a redirect, matching the resolver. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
