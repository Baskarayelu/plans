import Link from "next/link";
import { LogoMark } from "./Logo";
import { GITHUB_URL } from "@/lib/site";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/download", label: "Download" },
  { href: "/docs", label: "Docs" },
  { href: "/stats", label: "Live stats" },
  { href: "/docs/judges", label: "For judges" },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-4 pt-10 pb-14 text-sm text-muted">
      <span className="inline-flex items-center gap-2.5">
        <LogoMark />© 2026 Plans · Built for Monad Metropolis · MIT licence
      </span>
      <ul className="flex list-none flex-wrap gap-x-[18px] gap-y-2 p-0">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="no-underline hover:text-ink">
              {l.label}
            </Link>
          </li>
        ))}
        <li>
          <a href={GITHUB_URL} className="no-underline hover:text-ink" rel="noopener">
            GitHub
          </a>
        </li>
      </ul>
    </footer>
  );
}
