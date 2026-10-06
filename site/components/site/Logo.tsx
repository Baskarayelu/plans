import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("band inline-block h-3 w-[26px] rounded-[3px]", className)} />;
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 font-display text-[22px] leading-none font-extrabold tracking-[-0.02em] text-ink no-underline",
        className,
      )}
    >
      <LogoMark />
      plans
    </Link>
  );
}
