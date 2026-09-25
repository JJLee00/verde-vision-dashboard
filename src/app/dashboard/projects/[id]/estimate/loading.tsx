// Instant skeleton so opening the estimate paints the table shape rather
// than a blank page while the rows and the price book load.

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink/[0.06] ${className}`} />;
}

export default function EstimateLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <Block className="h-4 w-40" />
      <Block className="mt-4 h-10 w-64" />
      <Block className="mt-2 h-4 w-96" />
      <div className="mt-7 space-y-px rounded-[14px] border border-edge bg-card p-5">
        <Block className="h-9 w-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Block key={i} className="mt-2 h-8 w-full" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Block className="h-40 rounded-[14px]" />
        <Block className="h-72 rounded-[14px]" />
      </div>
    </div>
  );
}
