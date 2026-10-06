"use client";

// Split-flap board, ported from the Aceternity "Text Flipping Board" (ui.aceternity.com/registry/text-flipping-board.json)
// and recoloured to the Plans tokens: flaps use --flap / --flap-ink / --flap-edge, scramble flashes use the
// marigold accent only. Changes from the original: configurable columns, a muted label column, the £ and ₹
// characters, cycling between several boards, and no motion at all when the user prefers reduced motion.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$£₹.,-:/'·";

const BASE_COL_DELAY = 30;
const BASE_ROW_DELAY = 20;
const STEP_MS = 55;
const FLIP_S = 0.3;

// font follows the board width (container query units), so it stays as large as a cell allows on phones
const CELL_TEXT_STYLE: React.CSSProperties = { fontSize: "var(--flap-font)", lineHeight: 1 };

const FlapCell = React.memo(function FlapCell({
  target,
  delay,
  label,
  still,
}: {
  target: string;
  delay: number;
  label: boolean;
  still: boolean;
}) {
  const [current, setCurrent] = useState(still ? target : " ");
  const [prev, setPrev] = useState(" ");
  const [flipId, setFlipId] = useState(0);
  const [accent, setAccent] = useState(false);
  const curRef = useRef(still ? target : " ");
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (startTimer.current) clearTimeout(startTimer.current);
      if (stepTimer.current) clearTimeout(stepTimer.current);
      startTimer.current = stepTimer.current = null;
    };
    clear();
    const normalized = FLAP_CHARS.includes(target.toUpperCase()) ? target.toUpperCase() : " ";
    if (normalized === curRef.current) return clear;
    if (still) {
      startTimer.current = setTimeout(() => {
        curRef.current = normalized;
        setCurrent(normalized);
        setAccent(false);
      }, 0);
      return clear;
    }
    const scrambleCount = normalized === " " ? 6 + Math.floor(Math.random() * 5) : 10 + Math.floor(Math.random() * 12);
    const runStep = (i: number) => {
      const isLast = i === scrambleCount;
      const ch = isLast ? normalized : FLAP_CHARS[1 + Math.floor(Math.random() * (FLAP_CHARS.length - 1))];
      setPrev(curRef.current);
      curRef.current = ch;
      setCurrent(ch);
      setAccent(!isLast && Math.random() < 0.12);
      setFlipId((n) => n + 1);
      if (!isLast) stepTimer.current = setTimeout(() => runStep(i + 1), STEP_MS);
    };
    startTimer.current = setTimeout(() => runStep(1), delay);
    return clear;
  }, [target, delay, still]);

  const show = current === " " ? " " : current;
  const showPrev = prev === " " ? " " : prev;
  const textCx = "absolute inset-x-0 flex select-none items-center justify-center font-mono font-bold";
  const bg = accent ? "bg-accent" : "bg-flap";
  const fg = accent ? "text-on-accent" : label ? "text-muted" : "text-flap-ink";

  return (
    <div className="relative aspect-[3/5] overflow-hidden rounded-[2px] border border-flap-edge md:rounded-[3px]">
      <div className="relative h-full w-full [perspective:300px] [transform-style:preserve-3d]">
        {/* static top half (new char) */}
        <div className={cn("absolute inset-x-0 top-0 h-[calc(50%-0.5px)] overflow-hidden", bg)}>
          <div className={cn(textCx, fg, "top-0 h-[200%]")} style={CELL_TEXT_STYLE}>
            {show}
          </div>
        </div>
        {/* static bottom half (new char) */}
        <div className={cn("absolute inset-x-0 bottom-0 h-[calc(50%-0.5px)] overflow-hidden", bg)}>
          <div className={cn(textCx, fg, "bottom-0 h-[200%]")} style={CELL_TEXT_STYLE}>
            {show}
          </div>
        </div>
        {/* top flap (old char) falls */}
        {flipId > 0 && !still && (
          <motion.div
            key={flipId}
            className="absolute inset-x-0 top-0 z-10 h-[calc(50%-0.5px)] origin-bottom overflow-hidden bg-flap [backface-visibility:hidden]"
            initial={{ rotateX: 0 }}
            animate={{ rotateX: -100 }}
            transition={{ duration: FLIP_S, ease: [0.55, 0.055, 0.675, 0.19] }}
          >
            <div className={cn(textCx, label ? "text-muted" : "text-flap-ink", "top-0 h-[200%]")} style={CELL_TEXT_STYLE}>
              {showPrev}
            </div>
          </motion.div>
        )}
        {/* split line */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-px -translate-y-[0.5px] bg-flap-edge opacity-80" />
      </div>
    </div>
  );
});

export interface TextFlippingBoardProps {
  /** Several boards; the component cycles through them. Each board is a list of rows. */
  boards: string[][];
  rows?: number;
  cols?: number;
  /** leading columns rendered in the muted label colour */
  labelCols?: number;
  intervalMs?: number;
  className?: string;
  ariaLabel?: string;
}

export function TextFlippingBoard({
  boards,
  rows = 6,
  cols = 24,
  labelCols = 8,
  intervalMs = 7000,
  className,
  ariaLabel,
}: TextFlippingBoardProps) {
  const reduce = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // start when visible, then cycle (no cycling with reduced motion)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started || reduce || boards.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % boards.length), intervalMs);
    return () => clearInterval(t);
  }, [started, reduce, boards.length, intervalMs]);

  const grid = useMemo(() => {
    const lines = boards[index] ?? [];
    return Array.from({ length: rows }, (_, r) => (lines[r] ?? "").toUpperCase().padEnd(cols, " ").slice(0, cols));
  }, [boards, index, rows, cols]);

  const still = !!reduce;
  const active = started || still;

  return (
    <div ref={ref} className={cn("w-full [container-type:inline-size]", className)}>
      <div
        role="img"
        aria-label={ariaLabel ?? boards[index]?.join(". ")}
        className="grid gap-px min-[600px]:gap-[clamp(2px,0.4vw,5px)]"
        style={
          {
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            "--flap-font": `min(24px, calc(100cqw / ${cols} * 0.62))`,
          } as React.CSSProperties
        }
      >
        {grid.map((line, r) =>
          [...line].map((ch, c) => (
            <FlapCell
              key={`${r}-${c}`}
              target={active ? ch : " "}
              delay={c * BASE_COL_DELAY + r * BASE_ROW_DELAY}
              label={c < labelCols}
              still={still}
            />
          )),
        )}
      </div>
    </div>
  );
}
