export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="bg-muted h-9 w-64 animate-pulse rounded-md" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-4 rounded-xl border p-6 shadow-sm">
            <div className="bg-muted h-5 w-3/4 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </main>
  );
}
