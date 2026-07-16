// Instant skeleton for the project page so clicking a card paints the
// layout immediately instead of waiting on the data round-trips.

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink/[0.06] ${className}`} />;
}

export default function ProjectLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <Block className="h-4 w-24" />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-5">
          <Block className="h-20 w-28 rounded-[10px]" />
          <div className="space-y-2">
            <Block className="h-9 w-72" />
            <Block className="h-4 w-96" />
          </div>
        </div>
        <Block className="h-8 w-28 rounded-full" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Block className="h-[340px] rounded-[14px]" />
          <div className="grid gap-6 sm:grid-cols-2">
            <Block className="h-28 rounded-[14px]" />
            <Block className="h-28 rounded-[14px]" />
          </div>
          <Block className="h-64 rounded-[14px]" />
        </div>
        <div className="flex flex-col gap-6">
          <Block className="h-52 rounded-[14px]" />
          <Block className="h-48 rounded-[14px]" />
          <Block className="h-40 rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}
