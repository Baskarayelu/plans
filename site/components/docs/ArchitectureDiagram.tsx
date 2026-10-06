// Theme-aware architecture diagram for /docs/architecture (plain HTML/CSS, no motion).
function Box({ title, sub, items, tone }: { title: string; sub: string; items: string[]; tone?: "accent" | "chain" }) {
  return (
    <div
      className={
        "grid content-start gap-1.5 rounded-xl border p-3.5 " +
        (tone === "chain"
          ? "border-[color-mix(in_srgb,var(--accent)_60%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))]"
          : "border-line bg-surface")
      }
    >
      <span className="font-display text-[15px] font-bold">{title}</span>
      <span className="font-mono text-[11px] leading-snug text-muted">{sub}</span>
      <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-[13px] leading-snug">
        {items.map((i) => (
          <li key={i} className="m-0 p-0">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1.5 font-mono text-[11px] text-muted" aria-hidden="true">
      <span className="text-base leading-none text-ink">↓</span>
      {label}
    </div>
  );
}

export function ArchitectureDiagram() {
  return (
    <figure className="not-prose my-6 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Box
          title="Android app"
          sub="Expo / React Native · Mera passkeys"
          items={["Passkey → account key (signs)", "plans.keys.v1 → X25519 (encrypts)", "Signs EIP-712 + ERC-3009, never sends gas"]}
        />
        <Box
          title="plans.0xo.in"
          sub="Next.js on Vercel"
          items={["Download page, invite and claim fallbacks", "/.well-known/assetlinks.json", "Docs and live /stats"]}
        />
      </div>
      <Arrow label="signed messages (HTTPS)" />
      <Box
        title="Relayer"
        sub="Node 24 · Hono · viem · SQLite · Railway"
        items={["Validate → allowlist → simulate → send (eth_sendRawTransactionSync)", "Pays gas from 3 nonce lanes", "Signed FX reference, push, demo members, long-stop settle"]}
      />
      <Arrow label="transactions" />
      <Box
        tone="chain"
        title="Monad (chain 143)"
        sub="immutable contracts · no admin keys · AUSD"
        items={["PlansFactory → one Pot clone per plan", "ClaimEscrow · KeyRegistry · PlansSend", "AUSD (Agora) 0x00000000eFE3…9012a"]}
      />
      <Arrow label="events (HyperSync) and websocket logs" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Box
          title="Envio HyperIndex"
          sub="32 entities · GraphQL"
          items={["Ledgers, balances, settle-up graph", "Budgets, activity feed, fresh-device rebuild", "GlobalStats, DailyStats, Corridor"]}
        />
        <Box
          title="Back to the phones"
          sub="reads"
          items={["App: GraphQL for history and every derived number", "App: websocket logs for the instant buzz", "Site: /stats reads GraphQL"]}
        />
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">
        Anyone can submit a signed message. The relayer is a convenience, not a gatekeeper: the contracts enforce every rule.
      </figcaption>
    </figure>
  );
}
