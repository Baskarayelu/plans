// ClaimEscrow: money locked against a one-time claim key — pot LINK spends and send-by-link.
import { indexer } from "envio";
import { activity, dailyStats, ensureAccount, fundedAction, globalStats, recordFlow, updateUser } from "../lib/domain.js";
import { Store } from "../lib/store.js";
import { claimEntityId, decodeCode, lc, memberId, metaOf, spendEntityId } from "../lib/util.js";

indexer.onEvent({ contract: "ClaimEscrow", event: "ClaimCreated" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const id = claimEntityId(event.srcAddress, p.id);
  const source = lc(p.source);
  const pot = await s.load("Pot", source);
  let fromCountry = decodeCode(p.fromCountry);
  let isInternal: boolean;
  let spendId: string | undefined;
  if (pot) {
    // LINK spend. If the escrow does not carry a country for pot claims, use the proposer's.
    spendId = spendEntityId(pot.id, p.sourceSpendId);
    const spend = await s.get("Spend", spendId);
    if (!fromCountry && spend) fromCountry = (await s.get("Member", memberId(pot.id, spend.proposer_id)))?.country;
    isInternal = pot.isDemo;
  } else {
    const sender = await ensureAccount(s, source);
    if (fromCountry) sender.country = fromCountry;
    isInternal = sender.isInternal;
    if (!isInternal) {
      sender.nonInternalSendCount += 1;
      await updateUser(s, sender);
    }
  }
  s.put("Claim", {
    id,
    escrow: lc(event.srcAddress),
    claimId: p.id,
    source,
    sourceAccount_id: pot ? undefined : source,
    sourcePot_id: pot?.id,
    spend_id: spendId,
    claimSigner: lc(p.claimSigner),
    amount: p.amount,
    expiry: p.expiry,
    fromCountry,
    toCountry: undefined,
    recipient_id: undefined,
    status: "Open",
    isInternal,
    createdAt: s.m.ts,
    claimedAt: undefined,
    refundedAt: undefined,
    txHash: s.m.tx,
  });
  await activity(s, "ClaimCreated", { pot: pot ?? undefined, account: pot ? undefined : source, amount: p.amount, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "ClaimEscrow", event: "Claimed" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const id = claimEntityId(event.srcAddress, p.id);
  const claim = await s.load("Claim", id);
  const recipient = await ensureAccount(s, p.recipient);
  const toCountry = decodeCode(p.toCountry);
  if (toCountry) recipient.country = toCountry;
  if (!claim) {
    if (!context.isPreload) context.log.error(`Claim ${id} not found`);
    s.flush();
    return;
  }
  claim.status = "Claimed";
  claim.recipient_id = recipient.id;
  claim.toCountry = toCountry;
  claim.claimedAt = s.m.ts;

  const pot = claim.sourcePot_id ? await s.load("Pot", claim.sourcePot_id) : undefined;
  if (pot) {
    // Pot LINK claim: attributed to the pot (counted iff the pot is counted).
    claim.isInternal = pot.isDemo || recipient.isInternal;
    const spend = claim.spend_id ? await s.get("Spend", claim.spend_id) : undefined;
    await recordFlow(s, {
      source: "PotLinkClaim",
      fromCountry: claim.fromCountry,
      toCountry,
      amount: claim.amount,
      from: spend?.proposer_id ?? pot.id,
      to: recipient.id,
      pot,
    });
  } else {
    const sender = await s.get("Account", claim.source);
    claim.isInternal = (sender?.isInternal ?? false) || recipient.isInternal;
    if (!claim.isInternal) {
      const g = await globalStats(s);
      const d = await dailyStats(s, s.m.day);
      g.claims += 1;
      g.claimVolume += claim.amount;
      d.claims += 1;
      d.claimVolume += claim.amount;
      recipient.nonInternalSendCount += 1;
      await updateUser(s, recipient);
    }
    await recordFlow(s, {
      source: "SendLinkClaim",
      fromCountry: claim.fromCountry,
      toCountry,
      amount: claim.amount,
      from: claim.source,
      to: recipient.id,
      counted: !claim.isInternal,
    });
  }
  await fundedAction(s, recipient);
  await activity(s, "Claimed", { pot, account: recipient.id, counterparty: claim.source, amount: claim.amount, ref: id });
  s.flush();
});

indexer.onEvent({ contract: "ClaimEscrow", event: "ClaimRefunded" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const id = claimEntityId(event.srcAddress, p.id);
  const claim = await s.load("Claim", id);
  if (claim) {
    claim.status = "Refunded";
    claim.refundedAt = s.m.ts;
  }
  const pot = claim?.sourcePot_id ? await s.load("Pot", claim.sourcePot_id) : undefined;
  await activity(s, "ClaimRefunded", { pot, account: pot ? undefined : lc(p.to), amount: p.amount, ref: id });
  s.flush();
});
