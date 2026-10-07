/**
 * Web push routes (webpush.ts):
 *   POST   /v1/push/web  {address, subscription: {endpoint, keys: {p256dh, auth}}, deadline, signature}
 *          — the same EIP-191 proof as POST /v1/push/register, over webPushRegisterMessage.
 *   DELETE /v1/push/web  {endpoint} — the endpoint URL is a secret only the browser and this relayer
 *          hold, so knowing it is enough to drop it (this can only ever stop notifications).
 * The VAPID public key the browser subscribes with is in GET /v1/config (webPushPublicKey).
 */
import type { Context, Hono } from "hono";
import type { PublicClient } from "viem";
import { RelayError } from "../errors.js";
import { verifyWebPushRegistration, webPushUnregisterSchema, type WebPush } from "../webpush.js";

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RelayError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

export function mountWebPushRoutes(app: Hono, s: { client: PublicClient; webPush?: WebPush | null }) {
  const enabled = () => {
    if (!s.webPush?.enabled) throw new RelayError(404, "WEB_PUSH_DISABLED", "Browser notifications aren't set up on this relayer.");
    return s.webPush;
  };

  app.post("/v1/push/web", async (c) => {
    const web = enabled();
    const p = await verifyWebPushRegistration(s.client, await readJson(c));
    web.store.add(p.address, p.subscription);
    return c.json({ ok: true, address: p.address }, 200, { "cache-control": "no-store" });
  });

  app.delete("/v1/push/web", async (c) => {
    const web = enabled();
    const { endpoint } = webPushUnregisterSchema.parse(await readJson(c));
    return c.json({ ok: true, removed: web.store.remove(endpoint) }, 200, { "cache-control": "no-store" });
  });
}
