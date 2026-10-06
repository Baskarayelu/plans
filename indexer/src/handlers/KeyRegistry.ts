// KeyRegistry: X25519 keys. docs/traction.md "Accounts" = distinct non-internal addresses with KeyRegistered.
import { indexer } from "envio";
import { activity, ensureAccount, globalStats } from "../lib/domain.js";
import { Store } from "../lib/store.js";
import { metaOf } from "../lib/util.js";

indexer.onEvent({ contract: "KeyRegistry", event: "KeyRegistered" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const acc = await ensureAccount(s, event.params.account);
  const first = acc.keyRegisteredAt === undefined;
  acc.key = event.params.pubKey;
  acc.keyRegisteredAt = s.m.ts;
  if (first && !acc.isInternal) (await globalStats(s)).accounts += 1;
  await activity(s, "KeyRegistered", { account: acc.id });
  s.flush();
});
