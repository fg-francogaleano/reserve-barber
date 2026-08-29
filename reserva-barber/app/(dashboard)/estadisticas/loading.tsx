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
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="bg-muted h-32 w-full animate-pulse rounded-xl" />
        ))}
      </div>
    </main>
  );
}
