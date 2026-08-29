import { COPY } from '@/lib/copy';
import { RangeNav } from './RangeNav';

/**
 * The loading state, and the reason it renders the real control.
 *
 * `RangeNav` is drawn here exactly as the page draws it, with no selection —
 * which is what stops the six links vanishing and returning on every period the
 * owner tries. See `RangeNav` for the full argument and for why this segment has
 * no `layout.tsx`.
 *
 * Below it, a skeleton shaped like the five cards so the layout does not jump
 * when the real markup arrives.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.statistics.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.statistics.intro}</p>
      </div>

      <RangeNav />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="bg-muted h-32 w-full animate-pulse rounded-xl" />
        ))}
      </div>

      {/*
        Shaped like the two charts, not just like the cards. Without these the
        page grows by several hundred pixels the moment the real markup arrives,
        which on a control whose whole purpose is switching periods means the
        content jumps under the cursor on every selection.

        The tall block is the income chart and the thin one the method split;
        their heights track the real components rather than being round numbers.
      */}
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-6 w-48 animate-pulse rounded-md" />
          <div className="bg-muted h-56 w-full animate-pulse rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-6 w-40 animate-pulse rounded-md" />
          <div className="bg-muted h-4 w-full animate-pulse rounded-md" />
          <div className="bg-muted h-12 w-full animate-pulse rounded-md" />
        </div>
      </div>

      {/*
        D7's three sections, for the same reason the two above exist: without
        them the page grows by several hundred pixels the moment the real markup
        arrives, and on a control whose whole purpose is switching periods that
        means the content jumps under the cursor on every selection.

        The two short blocks are the rankings — rows of names and bars, so they
        are shorter than a chart — and the tall one is the twenty-four-column
        hour distribution, which is the same height as the income chart above.
      */}
      <div className="flex flex-col gap-8">
        {[0, 1].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="bg-muted h-6 w-44 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-full animate-pulse rounded-md" />
            <div className="bg-muted h-28 w-full animate-pulse rounded-xl" />
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <div className="bg-muted h-6 w-48 animate-pulse rounded-md" />
          <div className="bg-muted h-4 w-full animate-pulse rounded-md" />
          <div className="bg-muted h-56 w-full animate-pulse rounded-xl" />
        </div>
      </div>
    </main>
  );
}
