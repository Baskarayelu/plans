// From the Aceternity UI Pro block "Stats With Grid Background": the faded square grid in a card's top corner.
// The highlighted squares are passed in (no Math.random), so server and client render the same SVG.
import { useId } from "react";

export function GridPattern({
  width,
  height,
  x,
  y,
  squares,
  ...props
}: {
  width: number;
  height: number;
  x: number | string;
  y: number | string;
  squares: number[][];
} & React.SVGProps<SVGSVGElement>) {
  const patternId = useId();
  return (
    <svg aria-hidden="true" {...props}>
      <defs>
        <pattern id={patternId} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${patternId})`} />
      <svg x={x} y={y} className="overflow-visible">
        {squares.map(([sx, sy]) => (
          <rect strokeWidth="0" key={`${sx}-${sy}`} width={width + 1} height={height + 1} x={sx * width} y={sy * height} />
        ))}
      </svg>
    </svg>
  );
}

export function CornerGrid({ squares, size = 20 }: { squares: number[][]; size?: number }) {
  return (
    <div className="pointer-events-none absolute top-0 left-1/2 -mt-2 -ml-20 h-full w-full [mask-image:linear-gradient(white,transparent)]">
      <div className="absolute inset-0 bg-gradient-to-r from-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] to-[color-mix(in_srgb,var(--accent)_14%,transparent)] [mask-image:radial-gradient(farthest-side_at_top,white,transparent)]">
        <GridPattern
          width={size}
          height={size}
          x="-12"
          y="4"
          squares={squares}
          className="absolute inset-0 h-full w-full fill-[color-mix(in_srgb,var(--ink)_8%,transparent)] stroke-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
        />
      </div>
    </div>
  );
}

/** The folded corner that slides away on hover. */
export function EdgeFold() {
  return (
    <div className="absolute top-0 right-0 h-10 w-10 overflow-hidden border-b border-l border-line bg-bg shadow-[-3px_4px_9px_0px_rgba(0,0,0,0.12)] transition duration-200 group-hover/card:translate-x-14 group-hover/card:-translate-y-14 motion-reduce:transition-none">
      <div className="absolute top-0 left-0 h-px w-[141%] origin-top-left rotate-45 bg-line" />
    </div>
  );
}
