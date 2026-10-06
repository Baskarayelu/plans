// Single-series daily bar chart. Server-rendered SVG, no motion. Theme-aware through CSS tokens
// (--chart for bars, --line for the baseline, muted ink for labels). Each bar has a native tooltip;
// the page also offers the same data as a table.

export interface DailyPoint {
  date: string;
  value: number;
}

export function DailyBars({
  title,
  points,
  format,
}: {
  title: string;
  points: DailyPoint[];
  format: (v: number) => string;
}) {
  const W = 560;
  const H = 150;
  const padL = 4;
  const padR = 4;
  const padT = 22;
  const padB = 22;
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + p.value, 0);
  const n = Math.max(points.length, 1);
  const slot = (W - padL - padR) / n;
  const gap = Math.min(2, slot * 0.25);
  const barW = Math.max(1, Math.min(18, slot - gap));
  const plotH = H - padT - padB;
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0] ?? { date: "", value: 0 });

  return (
    <figure className="m-0 grid min-w-0 gap-2 rounded-[22px] border border-line bg-surface p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="font-mono text-xs text-muted tnum">total {format(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}, ${points.length} days, total ${format(total)}`}>
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(2, (p.value / max) * plotH) : 0;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padT + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={p.date}>
              <title>{`${p.date}: ${format(p.value)}`}</title>
              {/* generous hit target */}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill="var(--chart)"
                />
              ) : null}
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH + 0.5} y2={padT + plotH + 0.5} stroke="var(--line)" />
        {peak && peak.value > 0 ? (
          <text x={W - padR} y={12} textAnchor="end" fill="var(--muted)" style={{ font: "500 11px var(--font-mono)" }}>
            peak {format(peak.value)} · {peak.date}
          </text>
        ) : null}
        {points.length ? (
          <>
            <text x={padL} y={H - 6} fill="var(--muted)" style={{ font: "500 11px var(--font-mono)" }}>
              {points[0].date}
            </text>
            {points.length > 1 ? (
              <text x={W - padR} y={H - 6} textAnchor="end" fill="var(--muted)" style={{ font: "500 11px var(--font-mono)" }}>
                {points[points.length - 1].date}
              </text>
            ) : null}
          </>
        ) : null}
      </svg>
    </figure>
  );
}
