// Local stand-in for the relayer's keyed slots (PUT/GET /v1/slots/<64 hex>, relayer/src/slots.ts) so
// "link a browser" runs between browser contexts without touching the real relayer. One SlotStore is
// shared by every page that installs it; the semantics follow the relayer: write-once unless created
// with `auth` (then overwritable with the same auth), ttl 60–600 s, 404 NOT_FOUND, 409 SLOT_TAKEN;
// every slot has a `rev` (1 on create, +1 per write) and a PUT with `ifRev` is a compare-and-set
// (409 SLOT_CONFLICT {currentRev} when it differs; an absent slot is rev 0).
//
//   const store = new SlotStore();
//   await installSlots(page, store, "P");  // before page.goto; "P" tags this page's requests in store.log
//   store.down = true;                     // answer like a dropped connection (for 176c / 175)
//   store.urls                             // every slot request URL (to check no code ever appears in one)
//   store.log                              // {who, method, id, ifRev, status, code, t} per GET/PUT
//   store.forceConflict.add(id)            // every conditional write to `id` conflicts (a race that never ends)
//   store.holdPuts(id, ["P", "D"])         // hold the first PUT to `id` from each of these pages until all
//                                          // have arrived, then apply them together (a race on purpose);
//                                          // resolves {released, timedOut}
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
    this.slots = new Map(); // id → { data (b64u), expiresAt (unix s | null), authHash, rev }
    this.down = false;
    this.urls = [];
    this.bodies = [];
    this.log = [];
    this.forceConflict = new Set();
    this.holds = [];
  }
  /** See the header. `timeoutMs` releases whatever arrived if not everyone did. */
  holdPuts(id, whos, timeoutMs = 120_000) {
    const h = { id, want: new Set(whos), waiting: new Map(), done: false };
    h.promise = new Promise((resolve) => {
      h.release = (timedOut) => {
        if (h.done) return;
        h.done = true;
        clearTimeout(h.timer);
        for (const go of h.waiting.values()) go();
        this.holds = this.holds.filter((x) => x !== h);
        resolve({ released: [...h.waiting.keys()], timedOut });
      };
    });
    h.timer = setTimeout(() => h.release(true), timeoutMs);
    this.holds.push(h);
    return h.promise;
  }
  async #maybeHold(id, who) {
    const h = this.holds.find((x) => x.id === id && x.want.has(who) && !x.waiting.has(who));
    if (!h) return;
    const p = new Promise((go) => h.waiting.set(who, go));
    if ([...h.want].every((w) => h.waiting.has(w))) setTimeout(() => h.release(false), 0);
    await p;
  }
  /** Applies a PUT the way relayer/src/slots.ts does; returns [status, body]. */
  async put(id, body, who) {
    await this.#maybeHold(id, who);
    const cur = this.get(id);
    const authHash = body.auth ? sha(body.auth.toLowerCase()) : null;
    if (cur && (!cur.authHash || cur.authHash !== authHash)) return [409, { error: { code: "SLOT_TAKEN", message: "This slot is already taken." } }];
    const rev = cur ? cur.rev : 0;
    if (body.ifRev !== undefined && (body.ifRev !== rev || this.forceConflict.has(id)))
      return [409, { error: { code: "SLOT_CONFLICT", message: "This slot changed since you read it.", currentRev: rev } }];
    const expiresAt = body.ttl ? Math.floor(Date.now() / 1000) + body.ttl : null;
    this.slots.set(id, { data: body.data, expiresAt, authHash: cur ? cur.authHash : authHash, rev: rev + 1 });
    return [cur ? 200 : 201, { id, created: !cur, expiresAt, rev: rev + 1 }];
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

export async function installSlots(page, store, who = "?") {
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
        store.log.push({ who, method, id, status: s ? 200 : 404, t: Date.now() });
        return s ? json({ data: s.data, expiresAt: s.expiresAt, rev: s.rev }) : json({ error: { code: "NOT_FOUND", message: "No such slot." } }, 404);
      }
      if (method === "PUT") {
        let body;
        try {
          body = JSON.parse(req.postData() ?? "");
        } catch {
          return json({ error: { code: "INVALID_BODY" } }, 400);
        }
        store.bodies.push(req.postData() ?? "");
        const [status, out] = await store.put(id, body, who);
        store.log.push({ who, method, id, ifRev: body.ifRev, auth: !!body.auth, ttl: body.ttl ?? null, status, code: out.error?.code, t: Date.now() });
        return json(out, status);
      }
      return undefined;
    },
    { first: true },
  );
}
