import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { ProfileHeader } from '@/components/booking/ProfileHeader';
import { SocialLinkList } from '@/components/booking/SocialLinkList';
import { publicProfileUrl } from '@/server/domain/models/BusinessProfile';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { publicProfileService } from './publicProfileService';
import type { PublicProfileResolution } from '@/server/application/services/PublicProfileService';

/**
 * Rendered per request, like every other page in this project (design D7).
 *
 * Here it is a choice rather than a requirement, and the alternative was this
 * stack's first ISR configuration over `workerd` — new infrastructure adopted
 * for traffic that does not exist yet. The absent cache is recorded in
 * `docs/tech-debt.md`; the owner gets an edit that is visible on reload.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The origin for absolute metadata — from configuration only (design D3).
 *
 * `resolveOrigin` accepts a `Host` fallback and `/perfil` uses it, correctly:
 * there the header comes from the owner, addressed to themselves. Here it comes
 * from a stranger and would feed `metadataBase`, the canonical URL and the
 * OpenGraph tags, so a forged `Host` yields a page advertising someone else's
 * origin. This route simply does not offer those sources.
 *
 * `null` means absolute metadata is omitted — the link preview degrades, which
 * is visible and survivable, while the page itself still renders.
 */
function configuredOrigin(): string | null {
  return resolveOrigin({ configured: process.env.APP_ORIGIN });
}

/**
 * One resolution per request, shared by `generateMetadata` and the page.
 *
 * Both run for every request, and without `cache()` each would issue its own
 * query — doubling the database load on the one route in this project that has
 * neither a cache nor a rate limit in front of it (design D7, D12). React's
 * `cache` deduplicates within a single render pass, which is exactly the scope
 * these two share.
 */
const resolveSlug = cache(
  (slug: string): Promise<PublicProfileResolution> => publicProfileService().resolveBySlug(slug)
);

async function resolveForPage(slug: string): Promise<PublicProfileResolution> {
  try {
    return await resolveSlug(slug);
  } catch (error) {
    logger.error('Failed to resolve public profile', toErrorLogContext('resolveBySlug', error));
    throw error;
  }
}

/** Truncated at a word boundary, so a preview never ends mid-word. */
function toDescription(bio: string | null): string | undefined {
  if (bio === null) return undefined;

  const collapsed = bio.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 160) return collapsed;

  const cut = collapsed.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  // Must never throw: metadata generation runs before the page, and an
  // exception here turns a mistyped slug into a 500 instead of a 404.
  let resolution: PublicProfileResolution;
  try {
    resolution = await resolveSlug(slug);
  } catch {
    return {};
  }

  if (resolution.type !== 'render') {
    // Covers both the redirect and the not-found cases. The redirect target
    // renders its own metadata; the 404 must not be indexed.
    return { robots: { index: false, follow: false } };
  }

  const { profile } = resolution;
  const origin = configuredOrigin();
  const description = toDescription(profile.bio);
  const image = profile.coverUrl ?? profile.photoUrl;

  return {
    title: profile.businessName,
    ...(description !== undefined && { description }),
    ...(origin !== null && {
      metadataBase: new URL(origin),
      alternates: { canonical: `/b/${profile.publicSlug}` },
      openGraph: {
        type: 'website',
        locale: 'es_AR',
        title: profile.businessName,
        ...(description !== undefined && { description }),
        url: publicProfileUrl(origin, profile.publicSlug),
        ...(image !== null && { images: [{ url: image }] }),
      },
    }),
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const resolution = await resolveForPage(slug);

  if (resolution.type === 'notFound') {
    notFound();
  }

  if (resolution.type === 'redirect') {
    // 308: permanent, and method-preserving — so a future POST to a booking
    // route reached through a non-canonical prefix does not silently become a
    // GET.
    permanentRedirect(`/b/${resolution.canonicalSlug}`);
  }

  const { profile } = resolution;

  return (
    <main className="flex flex-1 flex-col pb-16">
      <ProfileHeader
        businessName={profile.businessName}
        photoUrl={profile.photoUrl}
        coverUrl={profile.coverUrl}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-4 pt-6">
        {/* Omitted entirely when absent. No placeholder stands in for a bio the
            owner did not write — a client does not need to be told what is
            missing from a shop's page. */}
        {profile.bio !== null && (
          <p className="text-muted-foreground max-w-prose text-center break-words">{profile.bio}</p>
        )}

        <div className="flex w-full flex-col items-center gap-2">
          {/* Inert until B2 ships `/b/{slug}/reservar` (design D2). Rendered as
              a disabled button rather than a link, so there is no target to
              navigate to and no dead end to reach — the same disclosure P1 made
              for a shareable link that did not resolve yet. */}
          <button
            type="button"
            disabled
            aria-describedby="booking-unavailable"
            className="bg-primary text-primary-foreground w-full max-w-xs rounded-md px-6 py-3 text-base font-medium disabled:opacity-50"
          >
            {COPY.publicProfile.book}
          </button>
          <p id="booking-unavailable" className="text-muted-foreground text-sm">
            {COPY.publicProfile.bookUnavailable}
          </p>
        </div>

        <SocialLinkList links={profile.socialLinks} />
      </div>
    </main>
  );
}
