// Instant paint while the viewer's data loads. Matches the viewer's
// brand-locked sand ground so the transition from the project page's
// embedded preview reads as seamless rather than a blank flash.

export default function ViewerLoading() {
  return (
    <div className="flex h-dvh flex-col bg-[#ebe0cb] text-ink">
      <header className="flex items-center gap-4 border-b border-rule px-4 py-2.5 sm:px-5">
        <div className="h-4 w-20 rounded bg-ink/[0.07]" />
        <div className="h-5 w-48 rounded bg-ink/[0.07]" />
        <div className="ml-auto flex gap-2.5">
          <div className="h-8 w-24 rounded-lg bg-ink/[0.07]" />
          <div className="h-8 w-36 rounded-lg bg-ink/[0.07]" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="animate-pulse font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
            Drawing the plan…
          </p>
        </div>
        <aside className="hidden w-[320px] shrink-0 border-l border-rule bg-card/60 md:block">
          <div className="border-b border-rule px-4 py-3">
            <div className="h-3 w-24 rounded bg-ink/[0.07]" />
          </div>
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-ink/[0.06]" />
                <div className="h-3 flex-1 rounded bg-ink/[0.06]" />
                <div className="h-3 w-10 rounded bg-ink/[0.06]" />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
