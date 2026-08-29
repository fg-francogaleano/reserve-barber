import Link from 'next/link';
import { COPY } from '@/lib/copy';
import {
  statisticsRangeHref,
  STATISTICS_RANGES,
  type StatisticsRange,
} from '@/server/application/dashboard/statisticsRangeParams';

/**
 * The period control, rendered by **both** the page and its loading state.
 *
 * ---
 *
 * **This is how design D9's open question was answered, and it landed on
 * neither of the two options that design wrote down.**
 *
 * The problem D9 named is real: a `loading.tsx` is a static file, so a control
 * placed only in the page disappears on every selection and returns highlighted
 * differently — roughly four tenths of a second at a time, repeatedly, on the
 * one page whose purpose is comparing periods.
 *
 * The design's proposed fix was to hoist the control into a route-segment
 * `layout.tsx`, which renders outside the suspense boundary and therefore
 * persists. Its own open half was that a layout **does not receive
 * `searchParams`** in the App Router, so it cannot know which period is
 * selected — leaving a control that never marks anything, or a Client Component
 * reading `useSearchParams`, which would spend this page's no-JavaScript
 * promise on a highlight.
 *
 * There is a third option, and it is strictly better than both: render the same
 * server component from `page.tsx` **and** from `loading.tsx`. The control never
 * disappears, because something is always drawing it; it carries a correct
 * `aria-current` in the settled state, because the page knows the resolved
 * range; and no client JavaScript is involved anywhere. The only artifact left
 * is that the highlight is absent for the duration of the transition, which is
 * the smallest of the three costs and the only one that is not a lie about
 * state.
 *
 * So there is **no `layout.tsx` for this segment**. That is deliberate, and this
 * comment is why.
 *
 * ---
 *
 * `prefetch={false}` follows D3's design D12 in its **corrected** form: it saves
 * an RSC payload request per link for a period the owner may never open. **Not**
 * because it saves a database round trip — this route has a `loading.tsx`, which
 * is where the default prefetch stops, and that claim was measured on a route
 * which does not have one.
 */
export function RangeNav({ current }: { current?: StatisticsRange }) {
  return (
    <nav aria-label={COPY.statistics.rangeLabel} className="flex flex-wrap gap-2">
      {STATISTICS_RANGES.map((range) => {
        const selected = range === current;

        return (
          <Link
            key={range}
            href={statisticsRangeHref(range)}
            prefetch={false}
            // Only ever set on the selected item — `aria-current="false"` is a
            // valid value that screen readers announce, so an unselected link
            // must carry no attribute at all rather than a falsy one.
            {...(selected ? { 'aria-current': 'page' as const } : {})}
            className={
              selected
                ? 'bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-3 text-sm font-medium'
                : 'border-input hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors'
            }
          >
            {COPY.statistics.ranges[range]}
          </Link>
        );
      })}
    </nav>
  );
}
