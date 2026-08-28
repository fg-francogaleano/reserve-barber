export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-9 w-40 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-80 max-w-full animate-pulse rounded-md" />
      </div>
      {/* Shaped like the table — a header row and five rows — so the layout
          does not jump when the real markup arrives. */}
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-10 w-full animate-pulse rounded-md" />
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="bg-muted h-12 w-full animate-pulse rounded-md" />
        ))}
      </div>
    </main>
  );
}
