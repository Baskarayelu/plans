// PlansSend: person-to-person sends with a receipt (country + currency + FX reference).
import { indexer } from "envio";
import { activity, dailyStats, ensureAccount, fundedAction, globalStats, recordFlow, updateUser } from "../lib/domain.js";
import { Store } from "../lib/store.js";
import { decodeCode, fxRoundEntityId, metaOf } from "../lib/util.js";

indexer.onEvent({ contract: "PlansSend", event: "Sent" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const from = await ensureAccount(s, p.from);
  const to = await ensureAccount(s, p.to);
  const fromCountry = decodeCode(p.fromCountry);
  const toCountry = decodeCode(p.toCountry);
  if (fromCountry) from.country = fromCountry;
  if (toCountry) to.country = toCountry;
  // A send is internal (excluded from traction) if either side is an internal account.
  const isInternal = from.isInternal || to.isInternal;
  const isCrossBorder = !!fromCountry && !!toCountry && fromCountry !== toCountry;
  s.put("Send", {
    id: s.m.eventId,
    from_id: from.id,
    to_id: to.id,
    amount: p.amount,
    fromCountry,
    toCountry,
    fromCurrency: decodeCode(p.fromCurrency),
    toCurrency: decodeCode(p.toCurrency),
    fxRateE8: p.fxRateE8,
    fxTimestamp: p.fxTimestamp,
    memoHash: p.memoHash,
    // FxReference round the app quoted from (0 = none); the contract computed refRateE8 / fxDiffBps from it.
    fxRoundId: p.fxRoundId,
    fxRound_id: fxRoundEntityId(p.fxRoundId),
    refRateE8: p.refRateE8,
    fxDiffBps: p.fxDiffBps,
    isCrossBorder,
    isInternal,
    timestamp: s.m.ts,
    txHash: s.m.tx,
  });
  if (!isInternal) {
    const g = await globalStats(s);
    const d = await dailyStats(s, s.m.day);
    g.sends += 1;
    g.sendVolume += p.amount;
    d.sends += 1;
    d.sendVolume += p.amount;
    from.nonInternalSendCount += 1;
    await updateUser(s, from);
  }
  await recordFlow(s, { source: "Send", fromCountry, toCountry, amount: p.amount, from: from.id, to: to.id, counted: !isInternal });
  await fundedAction(s, from);
  await activity(s, "Sent", { account: from.id, counterparty: to.id, amount: p.amount, ref: s.m.eventId });
  s.flush();
});
