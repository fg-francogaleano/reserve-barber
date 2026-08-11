export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="bg-muted h-9 w-64 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-full max-w-xl animate-pulse rounded-md" />
      <div className="flex max-w-xl flex-col gap-4">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="bg-muted h-4 w-24 shrink-0 animate-pulse rounded-md" />
            <div className="bg-muted h-8 w-28 animate-pulse rounded-md" />
            <div className="bg-muted h-8 w-28 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
      <div className="bg-muted h-9 w-24 animate-pulse rounded-md" />
    </main>
  );
}
