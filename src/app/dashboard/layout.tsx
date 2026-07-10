import Link from "next/link";
import { DashboardNav } from "./nav";
import { SignOutButton } from "./sign-out-button";

function Brand({ stacked = false }: { stacked?: boolean }) {
  if (stacked) {
    return (
      <Link
        href="/dashboard"
        aria-label="Verde Vision"
        className="block text-center"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/verde-vision-mark.png"
          alt="Verde Vision"
          className="mx-auto w-[88px] object-contain"
        />
      </Link>
    );
  }
  return (
    <Link
      href="/dashboard"
      aria-label="Verde Vision"
      className="flex items-center gap-2.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/verde-vision-mark.png"
        alt=""
        className="h-9 w-9 object-contain"
      />
      <span className="text-[0.8rem] font-bold uppercase tracking-[0.2em] text-ink">
        Verde Vision
      </span>
    </Link>
  );
}

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-rule bg-card/50 px-4 py-6 lg:flex">
        <div className="flex-1 pt-3">
          <p className="mb-3 px-3.5 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-faint">
            Menu
          </p>
          <DashboardNav />
        </div>
        <div className="border-t border-rule pt-3">
          <SignOutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <Brand />
        </div>
        <div className="relative">
          <div className="overflow-x-auto px-3 py-2">
            <DashboardNav horizontal />
          </div>
          <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-paper to-transparent" />
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
