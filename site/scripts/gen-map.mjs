// Generates the dotted world map used by components/ui/world-map.tsx (Aceternity World Map, which uses
// the `dotted-map` package). Precomputed once so the page doesn't ship or compute ~5k dots at runtime.
// Writes public/map/dots.svg (used as a CSS mask, so its colour follows the theme) and
// lib/map-data.json (viewBox size and city pins on the same grid).
// Usage: npm run gen:map
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import DottedMap from "dotted-map";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const map = new DottedMap({ height: 60, grid: "diagonal" });

const cities = {
  LON: { name: "London", lat: 51.5074, lng: -0.1278 },
  NYC: { name: "New York", lat: 40.7128, lng: -74.006 },
  BLR: { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
  LIS: { name: "Lisbon", lat: 38.7223, lng: -9.1393 },
  LOS: { name: "Lagos", lat: 6.5244, lng: 3.3792 },
};

const pins = {};
for (const [k, c] of Object.entries(cities)) {
  const p = map.getPin({ lat: c.lat, lng: c.lng });
  pins[k] = { name: c.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
}

const raw = map.getSVG({ radius: 0.22, color: "#000000", shape: "circle", backgroundColor: "transparent" });
const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(raw);
if (!vb) throw new Error("no viewBox in dotted-map output");
// compact: one group fill, short circles
const circles = [...raw.matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => `<circle cx="${m[1]}" cy="${m[2]}" r=".22"/>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb[1]} ${vb[2]}"><g fill="#000">${circles.join("")}</g></svg>`;

mkdirSync(join(root, "public/map"), { recursive: true });
writeFileSync(join(root, "public/map/dots.svg"), svg);
writeFileSync(
  join(root, "lib/map-data.json"),
  JSON.stringify({ width: +vb[1], height: +vb[2], pins }, null, 2) + "\n",
);
console.log(`dots.svg ${svg.length} bytes, viewBox ${vb[1]}x${vb[2]}`, pins);
