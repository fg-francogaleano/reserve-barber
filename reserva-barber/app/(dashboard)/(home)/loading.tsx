/**
 * The dashboard home's own skeleton.
 *
 * It lives in the `(home)` route group rather than replacing
 * `app/(dashboard)/loading.tsx`, and that is not tidiness. Every dashboard
 * route has its own loading boundary **except** the four create/edit form
 * routes, which inherit the group-level one — so rewriting that file into a
 * counter grid would show a grid of counter placeholders while a form loads.
 *
 * The shapes mirror the real page's: a heading, a six-card grid, then a list.
 * Matching the final heights is what keeps the grid from reflowing when the
 * figures arrive.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-12">
      <div className="bg-muted h-9 w-56 animate-pulse rounded-md" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="flex flex-col gap-3 rounded-xl border p-6 shadow-sm">
            <div className="bg-muted h-4 w-2/3 animate-pulse rounded-md" />
            <div className="bg-muted h-8 w-1/3 animate-pulse rounded-md" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <div className="bg-muted h-7 w-48 animate-pulse rounded-md" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </main>
  );
}
