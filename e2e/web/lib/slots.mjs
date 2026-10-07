// Local stand-in for the relayer's keyed slots (PUT/GET /v1/slots/<64 hex>, relayer/src/slots.ts) so
// "link a browser" runs between browser contexts without touching the real relayer. One SlotStore is
// shared by every page that installs it; the semantics follow the relayer: write-once unless created
// with `auth` (then overwritable with the same auth), ttl 60–600 s, 404 NOT_FOUND, 409 SLOT_TAKEN.
//
//   const store = new SlotStore();
//   await installSlots(page, store);      // before page.goto
//   store.down = true;                    // answer like a dropped connection (for 176c / 175)
//   store.urls                            // every slot request URL (to check no code ever appears in one)
import { createHash } from "node:crypto";
import { ORIGIN, route } from "./browser.mjs";

const CORS = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type,accept,authorization",
  "access-control-max-age": "600",
  "cache-control": "no-store",
};
const json = (body, status = 200) => ({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });

export class SlotStore {
  constructor() {
    this.slots = new Map(); // id → { data (b64u), expiresAt (unix s | null), authHash }
    this.down = false;
    this.urls = [];
    this.bodies = [];
  }
  get(id) {
    const s = this.slots.get(id);
    if (!s) return null;
    if (s.expiresAt !== null && s.expiresAt < Math.floor(Date.now() / 1000)) {
      this.slots.delete(id);
      return null;
    }
    return s;
  }
  bytes(id) {
    const s = this.get(id);
    return s ? new Uint8Array(Buffer.from(s.data, "base64url")) : null;
  }
}

const sha = (hex) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

export async function installSlots(page, store) {
  return route(
    page,
    async (req, url) => {
      if (!/relayer/.test(url.hostname)) return undefined;
      const m = /^\/v1\/slots\/([^/]+)$/.exec(url.pathname);
      if (!m) return undefined;
      const method = req.method();
      store.urls.push(url.href);
      if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
      if (store.down) return { status: 503, headers: CORS, body: "" }; // the app treats 5xx as "offline"
      const id = m[1];
      if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: { code: "INVALID_SLOT", message: "bad id" } }, 400);
      if (method === "GET") {
        const s = store.get(id);
        return s ? json({ data: s.data, expiresAt: s.expiresAt }) : json({ error: { code: "NOT_FOUND", message: "No such slot." } }, 404);
      }
      if (method === "PUT") {
        let body;
        try {
          body = JSON.parse(req.postData() ?? "");
        } catch {
          return json({ error: { code: "INVALID_BODY" } }, 400);
        }
        store.bodies.push(req.postData() ?? "");
        const cur = store.get(id);
        const authHash = body.auth ? sha(body.auth.toLowerCase()) : null;
        if (cur && (!cur.authHash || cur.authHash !== authHash)) return json({ error: { code: "SLOT_TAKEN", message: "This slot is already taken." } }, 409);
        const expiresAt = body.ttl ? Math.floor(Date.now() / 1000) + body.ttl : null;
        store.slots.set(id, { data: body.data, expiresAt, authHash: cur ? cur.authHash : authHash });
        return json({ created: !cur, expiresAt }, cur ? 200 : 201);
      }
      return undefined;
    },
    { first: true },
  );
}
