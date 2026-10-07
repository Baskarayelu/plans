// Link preview for /s/<pot> (design 135): the share card's numbers, 1200 × 630. Never the plan name
// (that only lives in the link's "#n=" part, which a server never sees) and never photos.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadProof } from "@/lib/plans-data";
import { summarize } from "@/lib/plans-proof";
import { SITE_HOST } from "@/lib/site";

export const alt = "How a group settled up on Plans: people, countries and amounts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

// Brand fonts (SIL OFL 1.1), latin subsets copied from brand/fonts and the Plex Mono release.
const fontDir = join(process.cwd(), "assets/og-fonts");
const fonts = Promise.all([
  readFile(join(fontDir, "Bricolage_Grotesque_wght_800.ttf")),
  readFile(join(fontDir, "Figtree_wght_600.ttf")),
  readFile(join(fontDir, "IBMPlexMono_500Medium.ttf")),
]);

const C = { bg: "#f4f6f1", surface: "#ffffff", ink: "#10231b", muted: "#5a6b62", line: "#d9e0d5", accent: "#f5b83d", band: "#2fa6b8" };

export default async function Image({ params }: { params: Promise<{ pot: string }> }) {
  const { pot } = await params;
  const [display, body, mono] = await fonts;
  const r = await loadProof(pot);
  const s = r.state === "ok" && r.data.status === "Settled" ? summarize(r.data) : null;

  const headline = s ? `${s.people} ${s.people === 1 ? "friend" : "friends"} · ${s.countryCount} ${s.countryCount === 1 ? "country" : "countries"} · settled in one tap` : "A shared pot for every plan, settled in one tap";
  const band = s
    ? `SETTLED · ${(s.settledOn ?? "").toUpperCase()} · ${s.people} ${s.people === 1 ? "FRIEND" : "FRIENDS"} · ${s.countryCount} ${s.countryCount === 1 ? "COUNTRY" : "COUNTRIES"}`
    : "PLANS · ON MONAD";
  const short = pot.length > 12 ? `${pot.slice(0, 6)}…${pot.slice(-4)}` : pot;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "Figtree" }}>
        <div style={{ flex: 1, display: "flex", padding: "52px 64px 36px", gap: 56 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", gap: 3, background: C.ink, borderRadius: 5, padding: 0, overflow: "hidden" }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ width: 11, height: 24, background: C.accent }} />
                ))}
              </div>
              <div style={{ fontFamily: "Bricolage", fontSize: 44, letterSpacing: -1 }}>plans</div>
            </div>
            <div style={{ fontFamily: "Bricolage", fontSize: 74, lineHeight: 1.02, letterSpacing: -3, marginTop: 40 }}>{headline}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: "Plex Mono", fontSize: 20, color: C.muted }}>{`${SITE_HOST}/s/${short} · Proof on Monad`}</div>
          </div>
          {s ? (
            <div style={{ width: 330, display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {s.countries.slice(0, 6).map((c) => (
                  <div
                    key={c.code ?? "none"}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `2px solid ${C.line}`, borderRadius: 999, padding: "6px 14px", fontSize: 22 }}
                  >
                    <span style={{ fontFamily: "Plex Mono" }}>{c.code ?? "—"}</span>
                    <span style={{ color: C.muted }}>×{c.count}</span>
                  </div>
                ))}
              </div>
              {[
                [s.putInShort, "put in together"],
                [s.paidOut, "paid back out"],
                ["All at once", s.transactions === 1 ? "everyone paid in 1 transaction" : `everyone paid in ${s.transactions} transactions`],
              ].map(([v, l]) => (
                <div key={l} style={{ display: "flex", flexDirection: "column", background: C.surface, border: `2px solid ${C.line}`, borderRadius: 22, padding: "12px 20px" }}>
                  <div style={{ fontFamily: "Bricolage", fontSize: 40, lineHeight: 1, letterSpacing: -1 }}>{v}</div>
                  <div style={{ fontSize: 19, color: C.muted, marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div
          style={{
            height: 72,
            display: "flex",
            alignItems: "center",
            padding: "0 64px",
            backgroundImage: `repeating-linear-gradient(90deg, ${C.band} 0 18px, #59b9c7 18px 20px)`,
            fontFamily: "Plex Mono",
            fontSize: 22,
            letterSpacing: 2,
            color: C.ink,
          }}
        >
          {band}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: display, weight: 800, style: "normal" },
        { name: "Figtree", data: body, weight: 600, style: "normal" },
        { name: "Plex Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
