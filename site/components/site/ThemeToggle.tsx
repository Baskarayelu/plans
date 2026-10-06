"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const ORDER = ["system", "light", "dark"] as const;
const LABEL = { system: "Theme: follows system", light: "Theme: light", dark: "Theme: dark" } as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // next-themes only knows the stored choice after hydration
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  const current = (mounted && (ORDER as readonly string[]).includes(theme ?? "") ? theme : "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`${LABEL[current]}. Switch to ${next}.`}
      title={LABEL[current]}
      className={cn(
        "inline-grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-surface-2",
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
