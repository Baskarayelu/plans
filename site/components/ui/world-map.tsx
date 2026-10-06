"use client";

// Aceternity "World Map" (as shipped in the Playful template and at ui.aceternity.com/registry/world-map.json),
// adapted for Plans:
// - the dotted map comes from `dotted-map`, precomputed by scripts/gen-map.mjs into /public/map/dots.svg and
//   drawn as a CSS mask, so the dots take the theme colour (--mapdot) with no hydration flash;
// - city pins come from dotted-map's own projection (lib/map-data.json), so arcs land on the right dots;
// - arcs draw in once when scrolled into view and city halos pulse, both skipped under reduced motion.

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import mapData from "@/lib/map-data.json";

type PinKey = keyof typeof mapData.pins;

export interface WorldMapProps {
  routes: Array<[PinKey, PinKey]>;
  ariaLabel: string;
  className?: string;
}

export function WorldMap({ routes, ariaLabel, className }: WorldMapProps) {
  const reduce = usePrefersReducedMotion();
  const { width, height, pins } = mapData;
  const curve = (a: PinKey, b: PinKey) => {
    const p = pins[a];
    const q = pins[b];
    const mx = (p.x + q.x) / 2;
    const my = Math.min(p.y, q.y) - 9;
    return `M ${p.x} ${p.y} Q ${mx} ${my} ${q.x} ${q.y}`;
  };

  return (
    <div className={className} style={{ position: "relative", aspectRatio: `${width} / ${height}` }}>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundColor: "var(--mapdot)",
          WebkitMask: "url(/map/dots.svg) center / 100% 100% no-repeat",
          mask: "url(/map/dots.svg) center / 100% 100% no-repeat",
        }}
      />
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="absolute inset-0 h-full w-full">
        <g fill="none" stroke="var(--accent)" strokeWidth={0.45} strokeLinecap="round">
          {routes.map(([a, b], i) =>
            reduce ? (
              <path key={`${a}-${b}`} d={curve(a, b)} />
            ) : (
              <motion.path
                key={`${a}-${b}`}
                d={curve(a, b)}
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 1.6, delay: 0.3 + i * 0.45, ease: [0.3, 0.6, 0.2, 1] }}
              />
            ),
          )}
        </g>
        {(Object.keys(pins) as PinKey[]).map((k, i) => {
          const p = pins[k];
          return (
            <g key={k}>
              {!reduce && (
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={0.9}
                  fill="var(--accent)"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={{ scale: 0.6, opacity: 0.6 }}
                  animate={{ scale: 2.6, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: i * 0.3 }}
                />
              )}
              <circle cx={p.x} cy={p.y} r={0.75} fill="var(--accent)" />
              <text
                x={p.x + 1.4}
                y={p.y + 0.7}
                fill="var(--ink)"
                className="[font:600_3px_var(--font-mono)] min-[700px]:[font:600_2.1px_var(--font-mono)]"
              >
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
