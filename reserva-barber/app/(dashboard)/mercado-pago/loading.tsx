/**
 * Skeleton for the initial read, matching the shape the page settles into so
 * the layout does not jump when the data arrives: heading, the status card,
 * then the two-field form.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-9 w-72 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-full max-w-lg animate-pulse rounded-md" />
      </div>
      <div className="bg-muted h-56 animate-pulse rounded-xl" />
      <div className="bg-muted h-64 animate-pulse rounded-xl" />
    </main>
  );
}
