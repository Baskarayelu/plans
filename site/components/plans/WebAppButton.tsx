import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Use Plans in your browser": the web app at /app, labelled "Coming soon" until it ships. */
export const WEB_APP_PATH = "/app";
export const WEB_APP_LIVE = false;

export function WebAppButton({ label = "Use Plans in your browser", className }: { label?: string; className?: string }) {
  return (
    <a
      href={WEB_APP_PATH}
      className={cn(
        "inline-flex min-h-12 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-full border border-line bg-surface px-[22px] py-2 text-center text-base leading-tight font-semibold text-ink no-underline hover:bg-surface-2 max-[420px]:px-4",
        className,
      )}
    >
      <Monitor className="size-[18px] flex-none max-[420px]:hidden" aria-hidden="true" />
      {label}
      {WEB_APP_LIVE ? null : (
        <small className="flex-none rounded-full border border-line bg-surface-2 px-[7px] py-1 font-mono text-[11px] leading-none font-medium text-muted">
          Coming soon
        </small>
      )}
    </a>
  );
}
