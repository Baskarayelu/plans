"use client";

import { useState } from "react";

// Same salts as the app: account = Mera's default salt, keys = sha256("plans.keys.v1").
const enc = new TextEncoder();
const sha256 = async (b: BufferSource) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fp = async (b?: ArrayBuffer) => (b ? (await sha256(b)).slice(0, 4).reduce((s, x) => s + x.toString(16).padStart(2, "0"), "") : null);
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer; second?: ArrayBuffer } };

export function PrfProbe() {
  const [log, setLog] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(mode: "create" | "existing") {
    setBusy(true);
    const out: Record<string, unknown> = { mode, userAgent: navigator.userAgent, at: new Date().toISOString() };
    try {
      const first = await sha256(enc.encode("mera.prf.salt.v1"));
      const second = await sha256(enc.encode("plans.keys.v1"));
      const prfAvailable =
        typeof PublicKeyCredential !== "undefined" &&
        (await PublicKeyCredential.getClientCapabilities?.().then((c: Record<string, boolean>) => c?.["extension:prf"]).catch(() => undefined));
      out.clientSaysPrf = prfAvailable ?? "unknown";
      let credId: string | undefined;
      if (mode === "create") {
        const cred = (await navigator.credentials.create({
          publicKey: {
            rp: { id: "plans.0xo.in", name: "Plans" },
            user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `Plans check ${out.at}`, displayName: "Plans check" },
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { residentKey: "required", userVerification: "required" },
            extensions: { prf: { eval: { first, second } } } as AuthenticationExtensionsClientInputs,
          },
        })) as PublicKeyCredential;
        const prf = (cred.getClientExtensionResults() as { prf?: PrfResults }).prf;
        credId = b64url(cred.rawId);
        out.create = { prfEnabled: prf?.enabled ?? null, firstAtCreate: await fp(prf?.results?.first), secondAtCreate: await fp(prf?.results?.second), attachment: cred.authenticatorAttachment };
      }
      const got = (await navigator.credentials.get({
        publicKey: {
          rpId: "plans.0xo.in",
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          userVerification: "required",
          ...(credId ? { allowCredentials: [{ type: "public-key", id: fromB64url(credId) }] } : {}),
          extensions: { prf: { eval: { first, second } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
      const prf = (got.getClientExtensionResults() as { prf?: PrfResults }).prf;
      out.get = { first: await fp(prf?.results?.first), second: await fp(prf?.results?.second), attachment: got.authenticatorAttachment, credential: hex(await sha256(got.rawId)).slice(0, 8) };
      out.verdict = prf?.results?.first && prf?.results?.second ? "PASS: both keys from one prompt" : prf?.results?.first ? "PARTIAL: only the account key came back" : "FAIL: no keys came back";
    } catch (e) {
      out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      out.verdict = "ERROR";
    }
    setLog(out);
    setBusy(false);
  }

  const text = log ? JSON.stringify(log, null, 2) : "";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => run("create")} className="min-h-12 rounded-full bg-accent px-5 font-semibold text-on-accent disabled:opacity-60">
          Create a test passkey and check
        </button>
        <button type="button" disabled={busy} onClick={() => run("existing")} className="min-h-12 rounded-full border border-line px-5 font-semibold">
          Check an existing Plans passkey
        </button>
      </div>
      {log && (
        <div className="grid gap-2">
          <p className="m-0 text-lg font-semibold" id="probe-verdict">{String(log.verdict)}</p>
          <pre id="probe-json" className="m-0 overflow-x-auto rounded-xl border border-line bg-surface p-4 font-mono text-xs leading-relaxed">{text}</pre>
          <button type="button" onClick={() => navigator.clipboard?.writeText(text).catch(() => {})} className="justify-self-start text-sm underline">
            Copy the result
          </button>
        </div>
      )}
    </div>
  );
}
