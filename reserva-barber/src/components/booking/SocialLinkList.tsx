import type { SocialLink, SocialPlatform } from '@/server/domain/models/BusinessProfile';
import { COPY } from '@/lib/copy';

/** The label a client sees. Never the enum member. */
const PLATFORM_LABEL: Record<SocialPlatform, string> = COPY.publicProfile.platforms;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Whether a stored URL may be rendered as an `href`.
 *
 * P1 validates this on the way in, and **this page is what that validation was
 * protecting** — so the check is repeated here rather than assumed. It costs a
 * parse and survives any future write path that does not run the P1 validator:
 * a seed, a migration, a support script. A stored `javascript:` URL rendered as
 * an `href` is stored cross-site scripting on a page anonymous visitors open.
 *
 * Exported for its test.
 */
export function isRenderableUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The shop's social links, or nothing at all.
 *
 * Renders no heading and no container when the set is empty. An empty section
 * with a title tells a client something is missing; omitting it tells them
 * nothing, which is correct — a shop without an Instagram account has not
 * failed at anything.
 */
export function SocialLinkList({ links }: { links: readonly SocialLink[] }) {
  const renderable = links.filter((link) => isRenderableUrl(link.url));

  if (renderable.length === 0) return null;

  return (
    <section className="flex flex-col items-center gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">
        {COPY.publicProfile.socialHeading}
      </h2>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {renderable.map((link) => (
          <li key={link.platform}>
            <a
              href={link.url}
              // New tab, because on a phone following this into the Instagram
              // application and coming back to a replaced tab is a one-way trip.
              target="_blank"
              // `noopener` is the security half — without it the opened page can
              // reach back through `window.opener`.
              rel="noopener noreferrer"
              className="border-border hover:bg-accent inline-flex rounded-full border px-4 py-2 text-sm font-medium transition-colors"
            >
              {PLATFORM_LABEL[link.platform]}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
