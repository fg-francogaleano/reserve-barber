export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="bg-muted h-9 w-64 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-full max-w-lg animate-pulse rounded-md" />
      <div className="flex max-w-lg flex-col gap-3">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="bg-muted size-4 shrink-0 animate-pulse rounded" />
            <div className="bg-muted h-4 w-2/5 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
      <div className="bg-muted h-9 w-24 animate-pulse rounded-md" />
    </main>
  );
}
