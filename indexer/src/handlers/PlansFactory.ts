// PlansFactory: registers each new Pot for indexing and records its creation.
import { indexer } from "envio";
import { activity, applyPotToStats, ensureAccount, ensurePot, globalStats } from "../lib/domain.js";
import { Store } from "../lib/store.js";
import { lc, metaOf } from "../lib/util.js";

indexer.contractRegister({ contract: "PlansFactory", event: "PotCreated" }, async ({ event, context }) => {
  context.chain.Pot.add(event.params.pot);
});

indexer.onEvent({ contract: "PlansFactory", event: "PotCreated" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  // Pot events from the same transaction (RulesSet, the creator's MemberJoined, Contributed…) may
  // already have created a stub row; fill it in.
  const pot = await ensurePot(s, p.pot);
  const creator = await ensureAccount(s, p.creator);
  if (pot.registered) {
    s.flush();
    return;
  }
  pot.registered = true;
  pot.factory = lc(event.srcAddress);
  pot.creator_id = creator.id;
  pot.createdAt = s.m.ts;
  pot.createdBlock = s.m.block;
  pot.createdTx = s.m.tx;
  pot.createdDay = s.m.day;
  pot.startTime = p.startTime;
  pot.endTime = p.endTime;
  pot.reviewWindow = p.reviewWindow;
  pot.meta = p.meta;
  pot.inviteKeyWrap = p.inviteKeyWrap;

  const g = await globalStats(s);
  g.allPots += 1;
  // Demo plan: creator is internal (demo or team), or a Demo account already joined.
  if (creator.isInternal) pot.isDemo = true;
  if (pot.isDemo) g.demoPots += 1;
  else await applyPotToStats(s, pot, 1);

  await activity(s, "PotCreated", { pot, account: creator.id });
  s.flush();
});
