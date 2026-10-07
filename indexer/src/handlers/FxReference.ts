// FxReference: reference FX rounds written by a Chainlink CRE workflow (display / receipts only;
// the contract never holds or moves funds). Sends and settlements link to the round they cite.
import { indexer } from "envio";
import { type E, Store } from "../lib/store.js";
import { FX_CURRENCIES, fxRoundEntityId, lc, metaOf } from "../lib/util.js";

const ZERO = "0x0000000000000000000000000000000000000000";

/** The config row of an FxReference contract. The constructor emits every config event, so this is
 *  normally created by OwnershipTransferred / SimulationModeSet / MaxMoveSet in the deploy tx. */
async function ensureConfig(s: Store, address: string): Promise<E<"FxReferenceConfig">> {
  const addr = lc(address);
  const { e } = await s.getOr("FxReferenceConfig", addr, () => ({
    id: addr,
    address: addr,
    mode: "Simulation" as const,
    forwarder: undefined,
    simTransmitter: undefined,
    workflowId: undefined,
    workflowOwner: undefined,
    maxMoveBps: 1_000, // DEFAULT_MAX_MOVE_BPS
    owner: undefined,
    pendingOwner: undefined,
    latestRound_id: undefined,
    latestRoundId: 0n,
    latestScheduledTime: 0n,
    roundCount: 0,
    updatedAt: s.m.ts,
    updatedBlock: s.m.block,
  }));
  e.updatedAt = s.m.ts;
  e.updatedBlock = s.m.block;
  return e;
}

indexer.onEvent({ contract: "FxReference", event: "RoundWritten" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const p = event.params;
  const rates = FX_CURRENCIES.map((_, i) => p.usdPerUnitE8[i] ?? 0n);
  const masks = FX_CURRENCIES.map((_, i) => Number(p.sourceMasks[i] ?? 0n));
  const id = fxRoundEntityId(p.roundId) ?? "0";
  const [rateGBP, rateEUR, rateINR, rateNGN, rateJPY, rateCHF, rateAED, rateSGD] = rates as [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  ];
  const [maskGBP, maskEUR, maskINR, maskNGN, maskJPY, maskCHF, maskAED, maskSGD] = masks as [
    number, number, number, number, number, number, number, number,
  ];
  s.put("FxRound", {
    id,
    fxReference: lc(event.srcAddress),
    roundId: p.roundId,
    scheduledTime: p.scheduledTime,
    writtenAt: s.m.ts,
    rateDate: Number(p.rateDate),
    sourceMask: Number(p.sourceMask),
    currencies: [...FX_CURRENCIES],
    usdPerUnitE8: [...p.usdPerUnitE8],
    sourceMasks: p.sourceMasks.map(Number),
    presentCount: rates.filter((r) => r > 0n).length,
    rateGBP, rateEUR, rateINR, rateNGN, rateJPY, rateCHF, rateAED, rateSGD,
    maskGBP, maskEUR, maskINR, maskNGN, maskJPY, maskCHF, maskAED, maskSGD,
    blockNumber: s.m.block,
    txHash: s.m.tx,
  });
  const cfg = await ensureConfig(s, event.srcAddress);
  // round ids are strictly increasing (scheduledTime must exceed the last accepted one)
  if (p.roundId >= cfg.latestRoundId) {
    cfg.latestRound_id = id;
    cfg.latestRoundId = p.roundId;
    cfg.latestScheduledTime = p.scheduledTime;
  }
  cfg.roundCount += 1;
  s.flush();
});

indexer.onEvent({ contract: "FxReference", event: "SimulationModeSet" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const cfg = await ensureConfig(s, event.srcAddress);
  cfg.mode = "Simulation";
  cfg.forwarder = lc(event.params.forwarder);
  cfg.simTransmitter = lc(event.params.simTransmitter);
  cfg.workflowId = undefined;
  cfg.workflowOwner = undefined;
  s.flush();
});

indexer.onEvent({ contract: "FxReference", event: "ProductionModeSet" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const cfg = await ensureConfig(s, event.srcAddress);
  cfg.mode = "Production";
  cfg.forwarder = lc(event.params.forwarder);
  cfg.simTransmitter = undefined;
  cfg.workflowId = event.params.workflowId;
  cfg.workflowOwner = lc(event.params.workflowOwner);
  s.flush();
});

indexer.onEvent({ contract: "FxReference", event: "MaxMoveSet" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const cfg = await ensureConfig(s, event.srcAddress);
  cfg.maxMoveBps = Number(event.params.maxMoveBps);
  s.flush();
});

indexer.onEvent({ contract: "FxReference", event: "OwnershipTransferStarted" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const cfg = await ensureConfig(s, event.srcAddress);
  // transferOwnership(address(0)) cancels a pending handover
  const next = lc(event.params.newOwner);
  cfg.pendingOwner = next === ZERO ? undefined : next;
  s.flush();
});

indexer.onEvent({ contract: "FxReference", event: "OwnershipTransferred" }, async ({ event, context }) => {
  const s = new Store(context, metaOf(event));
  const cfg = await ensureConfig(s, event.srcAddress);
  cfg.owner = lc(event.params.newOwner);
  cfg.pendingOwner = undefined;
  s.flush();
});
