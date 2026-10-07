/**
 * The hand-copied ABIs in src/abi.ts must match the contracts: event topics from the spec, and
 * (when contracts/out is built) every event, function and the SendMeta tuple of the artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { allEventsAbi, factoryAbi, fxReferenceAbi, plansSendAbi, potAbi } from "../../src/abi.js";
import { LISTENER_EVENTS } from "../../src/listener.js";

const OUT = resolve(import.meta.dirname, "../../../contracts/out");
const ev = (abi: readonly unknown[], name: string) => (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!;

describe("ABI shapes", () => {
  it("event topics match the contracts", () => {
    expect(toEventSelector(ev(potAbi, "Collected"))).toBe("0x484decdc1e9549e1866295f6f86c889ded3f7de410e7488a7a415978589dc8fd");
    expect(toEventSelector(ev(potAbi, "Settled"))).toBe("0x4a7b234a4bdfc722e8e9d251a072b4e04917b9f23c9eb95930d009b47c810d4a");
    expect(toEventSelector(ev(plansSendAbi, "Sent"))).toBe("0x23c552becce99eb89d1a96f69d7578207d91127ef5d5ccbeb167f7aedf77313b");
    expect(toEventSelector(ev(fxReferenceAbi, "RoundWritten"))).toBe("0x8476deb7dae7ccbca73276a9dc7a676dd3d71d7dd028588e95c88c4c111a233e");
  });

  it("receipts decode Collected and RoundWritten; the listener tracks Collected", () => {
    const names = (allEventsAbi as readonly { name?: string }[]).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Collected", "Settled", "Sent", "RoundWritten"]));
    expect(LISTENER_EVENTS.map((e) => e.name)).toContain("Collected");
  });

  const artifacts: [string, readonly unknown[]][] = [
    ["Pot", potAbi],
    ["PlansFactory", factoryAbi],
    ["PlansSend", plansSendAbi],
    ["FxReference", fxReferenceAbi],
  ];
  it.skipIf(!existsSync(join(OUT, "Pot.sol", "Pot.json")))("every hand-copied event and function exists in contracts/out", () => {
    for (const [name, abi] of artifacts) {
      const built = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi as (AbiEvent | AbiFunction)[];
      const builtEvents = new Set(built.filter((x) => x.type === "event").map((x) => toEventSelector(x as AbiEvent)));
      const builtFns = new Set(built.filter((x) => x.type === "function").map((x) => toFunctionSelector(x as AbiFunction)));
      for (const x of abi as (AbiEvent | AbiFunction)[]) {
        if (x.type === "event") expect(builtEvents.has(toEventSelector(x)), `${name}.${x.name}`).toBe(true);
        if (x.type === "function") expect(builtFns.has(toFunctionSelector(x)), `${name}.${x.name}`).toBe(true);
      }
    }
  });
});
