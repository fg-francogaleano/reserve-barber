export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="bg-muted h-9 w-64 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-full max-w-xl animate-pulse rounded-md" />
      <div className="flex max-w-xl flex-wrap gap-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="bg-muted h-9 w-40 animate-pulse rounded-md" />
        ))}
      </div>
      <div className="bg-muted h-9 w-24 animate-pulse rounded-md" />
      <div className="flex flex-col gap-2">
        {[0, 1].map((index) => (
          <div key={index} className="bg-muted h-12 w-full animate-pulse rounded-md" />
        ))}
      </div>
    </main>
  );
}
