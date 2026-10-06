import Link from "next/link";
import { cn } from "@/lib/utils";

type BtnProps = {
  href: string;
  variant?: "primary" | "ghost";
  children: React.ReactNode;
  className?: string;
  external?: boolean;
};

const btnBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border px-[22px] text-base font-semibold leading-none whitespace-nowrap no-underline cursor-pointer";
const btnVariant = {
  primary:
    "border-transparent bg-accent text-on-accent shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105",
  ghost: "border-line bg-surface text-ink hover:bg-surface-2",
};

export function Button({ href, variant = "primary", children, className, external }: BtnProps) {
  const cls = cn(btnBase, btnVariant[variant], className);
  if (external || href.startsWith("intent:") || href.startsWith("http"))
    return (
      <a href={href} className={cls} rel={external ? "noopener" : undefined}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function BtnTag({ children }: { children: React.ReactNode }) {
  return (
    <small className="rounded-full bg-[rgba(16,35,27,.12)] px-[7px] py-1 font-mono text-[11px] leading-none font-medium">
      {children}
    </small>
  );
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border border-line bg-surface-2 px-[11px] py-[7px] font-mono text-xs leading-none font-semibold tracking-[.08em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone?: "pos" | "neg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-[9px] py-1.5 text-xs leading-none font-semibold",
        tone === "pos" && "text-pos",
        tone === "neg" && "text-neg",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card", className)}>{children}</div>
  );
}

export function SectionHeader({
  id,
  badge,
  title,
  lede,
}: {
  id: string;
  badge: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
}) {
  return (
    <div className="mb-11 grid justify-items-center gap-3.5 text-center">
      <Badge>{badge}</Badge>
      <h2
        id={id}
        className="m-0 max-w-[820px] font-display text-[clamp(32px,4.4vw,52px)] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance"
      >
        {title}
      </h2>
      {lede ? <p className="m-0 max-w-[620px] text-lg text-pretty text-muted">{lede}</p> : null}
    </div>
  );
}

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1180px] pt-12 pb-6 sm:pt-16", className)}>{children}</div>;
}
