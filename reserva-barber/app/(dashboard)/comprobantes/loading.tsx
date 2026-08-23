/**
 * The queue's skeleton.
 *
 * A single column rather than the two-up grid the barber list uses: each row
 * here is a decision with two controls under it, and reading them side by side
 * would invite approving one while looking at another's amount.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="bg-muted h-9 w-72 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-full animate-pulse rounded-md" />
      <div className="flex flex-col gap-4">
        {[0, 1].map((index) => (
          <div key={index} className="flex flex-col gap-4 rounded-xl border p-6 shadow-sm">
            <div className="bg-muted h-5 w-2/3 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-4/5 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded-md" />
            <div className="bg-muted h-9 w-56 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </main>
  );
}
