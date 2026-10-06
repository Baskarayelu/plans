/** Design tokens from design/gen/app.css (approved design). */
export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  pos: string;
  neg: string;
  info: string;
  scrim: string;
  skel: string;
  accentText: string; // .k-acc banner tint
  dark: boolean;
};

export const light: Palette = {
  bg: "#F4F6F1",
  surface: "#FFFFFF",
  surface2: "#EAEFE7",
  ink: "#10231B",
  muted: "#5A6B62",
  line: "#D9E0D5",
  accent: "#F5B83D",
  onAccent: "#10231B",
  pos: "#1F7A55",
  neg: "#B8432F",
  info: "#2B5F8A",
  scrim: "rgba(16,35,27,0.42)",
  skel: "#E3E9DF",
  accentText: "#C8901A",
  dark: false,
};

export const dark: Palette = {
  bg: "#0C1511",
  surface: "#14201A",
  surface2: "#1B2A22",
  ink: "#E8F0EA",
  muted: "#93A69A",
  line: "#26362D",
  accent: "#F5B83D",
  onAccent: "#10231B",
  pos: "#4CC38A",
  neg: "#FF7A66",
  info: "#7FB2DE",
  scrim: "rgba(0,0,0,0.62)",
  skel: "#1D2C24",
  accentText: "#F5B83D",
  dark: true,
};

/** Wristband colours (design W). */
export const WRISTBANDS = {
  lagoon: "#2FA6B8",
  orchid: "#D9539B",
  marigold: "#F5B83D",
  coral: "#F07A5A",
  lime: "#8DBF3F",
  iris: "#8C93F0",
} as const;

export const WRISTBAND_LIST = Object.values(WRISTBANDS);

/** Avatar colours for people (design P). */
export const AVATAR_COLORS = ["#D9634B", "#3C78B8", "#8C5CC4", "#2B8A5F", "#B7792A", "#5E6B73", "#C24F7A", "#3E8E9E"];

export const fonts = {
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_500Medium",
  bodySemi: "Figtree_600SemiBold",
  bodyBold: "Figtree_700Bold",
  mono: "IBMPlexMono_500Medium",
  monoSemi: "IBMPlexMono_600SemiBold",
};

/** Mix `a` over `b` at `p` (0..1) like CSS color-mix(in srgb, a p%, b). */
export function mix(a: string, p: number, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((x, i) => Math.round(x * p + pb[i] * (1 - p)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function parse(h: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
