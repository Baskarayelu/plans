import Link from "next/link";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { DOWNLOAD_PATH, LANDING_NAV } from "@/lib/site";

export function SiteNav() {
  return (
    <nav aria-label="Main" className="sticky top-3 z-50 mt-3">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 rounded-[18px] border border-line bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] py-2.5 pr-2.5 pl-4 backdrop-blur-md">
        <Logo />
        <ul className="hidden list-none gap-[22px] text-[15px] font-medium min-[900px]:flex">
          {LANDING_NAV.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-muted no-underline hover:text-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href={DOWNLOAD_PATH}
            className="inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold whitespace-nowrap text-on-accent no-underline shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105"
          >
            <span className="min-[420px]:hidden">Get the app</span>
            <span className="hidden min-[420px]:inline">Get the Android app</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
