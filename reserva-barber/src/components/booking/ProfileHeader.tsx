import { COPY } from '@/lib/copy';

interface ProfileHeaderProps {
  businessName: string;
  photoUrl: string | null;
  coverUrl: string | null;
}

/**
 * Up to two letters taken from the first two words of the business name.
 *
 * Exported for its test. Uses the spread form rather than `charAt` so an
 * astral-plane character — an emoji in a shop name is not exotic — yields one
 * whole glyph instead of half a surrogate pair.
 */
export function initialsFrom(businessName: string): string {
  return businessName
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => [...word][0]?.toLocaleUpperCase('es-AR') ?? '')
    .join('');
}

/**
 * Cover band and profile image (B1 design D1).
 *
 * Plain `<img>`, not `next/image`: no remote pattern is configured, and
 * OpenNext on `workerd` does not run the framework's optimizer, so that path is
 * both unconfigured and unproven on this runtime. What makes optimization
 * unnecessary is that P1 already shrinks images in the browser before upload.
 *
 * **Both slots reserve their space before anything loads** — the cover through
 * an enforced aspect ratio, the avatar through fixed dimensions. Storage is a
 * host this Worker does not control, and a layout that reflows as an image
 * resolves moves the booking control out from under a thumb already travelling
 * toward it.
 *
 * The absences are designed rather than defaulted: a shop that has saved only a
 * name still gets a page that looks deliberate, because that is the state every
 * owner is in minutes after their first save.
 */
export function ProfileHeader({ businessName, photoUrl, coverUrl }: ProfileHeaderProps) {
  return (
    <header className="flex flex-col">
      {/* No `relative` here on purpose. It positioned nothing — there is no
          absolutely-placed child — but it made this band a positioned element,
          and positioned elements paint above static ones regardless of DOM
          order. That is what buried the top half of the avatar below. */}
      <div className="bg-muted aspect-[3/1] w-full overflow-hidden sm:aspect-[4/1]">
        {coverUrl !== null && (
          // `next/image` is deliberately not used here (design D1): no remote
          // pattern is configured and OpenNext on `workerd` does not run the
          // optimizer, so that path is unconfigured and unproven. The payload
          // was already solved upstream — P1 downscales in the browser.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={COPY.publicProfile.coverAlt(businessName)}
            className="h-full w-full object-cover"
            // Above the fold, and the largest thing on the page: this is the
            // one image on this route that must not be deferred.
            loading="eager"
          />
        )}
      </div>

      {/* `relative z-10` is what puts the avatar ON TOP of the cover. The
          `-mt-12` only moves it upward; without an explicit stacking position
          those 48px render *behind* the band and the avatar appears sliced in
          half. Removing the cover's `relative` alone would fix it today, but
          this states the intent so the next positioned element added above
          cannot silently bury it again. */}
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4">
        <div className="bg-secondary text-secondary-foreground border-background -mt-12 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 text-2xl font-semibold">
          {photoUrl === null ? (
            <span aria-hidden="true">{initialsFrom(businessName)}</span>
          ) : (
            // Same reasoning as the cover above (design D1).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={COPY.publicProfile.photoAlt(businessName)}
              width={96}
              height={96}
              className="h-full w-full object-cover"
              loading="eager"
            />
          )}
        </div>

        {/* `w-full` is load-bearing, not cosmetic, and `break-words` alone is
            NOT enough — measured in the browser at the column's 120-character
            maximum. This is a flex item under `items-center`, so without an
            explicit width it sizes to its content and grows past the container;
            the page then scrolled horizontally to 2014px inside a 1366px
            viewport. Constraining the width is what gives `break-words`
            something to break against. T18 records this same overflow reaching
            production once already, on the barbers list. */}
        <h1 className="w-full text-center text-3xl font-semibold tracking-tight break-words">
          {businessName}
        </h1>
      </div>
    </header>
  );
}
