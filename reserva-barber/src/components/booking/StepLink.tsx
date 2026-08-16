import Link from 'next/link';
import type { ReactNode } from 'react';

interface StepLinkProps {
  href: string;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * Every navigation in the public booking flow, with prefetching **off**.
 *
 * **Measured on `workerd`, not anticipated.** Next's router prefetches the RSC
 * payload of each `<Link>` that enters the viewport, and on this route that
 * payload is a full catalogue read. So rendering the branch step fired one extra
 * server request *per branch* before the client touched anything — a page view
 * costs `1 + L` catalogue queries instead of 1, and the service step at the
 * per-owner cap of fifty services would cost `1 + 50`.
 *
 * At roughly 0.35–0.40 s per Supavisor round trip, on the one route in this
 * project with neither a cache nor a rate limit (`docs/tech-debt.md` T47), and
 * against a pool shared with the owner's dashboard, that is amplification the
 * flow gets nothing for: the client picks exactly one option per step, so every
 * other prefetch is work thrown away.
 *
 * What it costs is real and was accepted knowingly: the tap now waits for the
 * navigation (~1 s measured) instead of finding it warmed. The per-option
 * pending state is what covers that wait.
 *
 * It lives in one component rather than as a prop repeated at six call sites,
 * because a decision spread across six places is one someone re-enables at five
 * of them without noticing.
 */
export function StepLink({ href, className, children }: StepLinkProps) {
  return (
    <Link href={href} prefetch={false} className={className}>
      {children}
    </Link>
  );
}
