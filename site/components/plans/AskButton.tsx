"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Opens the system share sheet with a prefilled message, or copies it where sharing isn't available. */
export function AskButton({ label, message, className }: { label: string; message: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          if (typeof navigator.share === "function") {
            await navigator.share({ text: message });
            return;
          }
          await navigator.clipboard.writeText(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* share cancelled or clipboard blocked: nothing to do */
        }
      }}
      className={cn(
        "inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-accent px-[22px] text-base font-semibold text-on-accent shadow-[inset_0_-2px_0_rgba(16,35,27,.18)] hover:brightness-105",
        className,
      )}
    >
      {copied ? <Check className="size-[18px]" aria-hidden="true" /> : <Share2 className="size-[18px]" aria-hidden="true" />}
      {copied ? "Message copied" : label}
    </button>
  );
}
