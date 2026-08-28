export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-9 w-64 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-32 animate-pulse rounded-md" />
      </div>
      {/* Shaped like the day — navigation, heading, three rows — so the layout
          does not jump when the real markup arrives. */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="bg-muted h-10 w-28 animate-pulse rounded-md" />
        ))}
      </div>
      <div className="bg-muted h-7 w-56 animate-pulse rounded-md" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
            <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-24 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </main>
  );
}
