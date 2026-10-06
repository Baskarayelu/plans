/** Inline status marker used throughout the docs for anything not live yet. */
export function Pending({ children = "Pending" }: { children?: React.ReactNode }) {
  return (
    <span className="not-prose inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-2 py-0.5 align-[0.1em] font-mono text-[11px] leading-none font-semibold tracking-wide text-ink uppercase">
      {children}
    </span>
  );
}
