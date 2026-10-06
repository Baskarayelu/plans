import { getAddress, verifyMessage, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { ChainEvent } from "../../src/listener.js";
import { formatUsd, notificationsFor, PushDispatcher, pushRegisterMessage, verifyPushRegistration } from "../../src/push.js";
import { Store } from "../../src/store.js";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const fakeClient = { verifyMessage: (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args) };
const TOKEN = "ExponentPushToken[abcdefghijkl1234]";
const POT = getAddress("0x9000000000000000000000000000000000000009");
const A = getAddress("0x00000000000000000000000000000000000000a1");
const B = getAddress("0x00000000000000000000000000000000000000b2");
const C = getAddress("0x00000000000000000000000000000000000000c3");

function setup() {
  const s = new Store(":memory:");
  s.upsertPot({ address: POT, creator: A, startTime: 0, endTime: 10, reviewWindow: 0, createdBlock: 1 });
  for (const [i, m] of [A, B, C].entries()) s.upsertMember(POT, m, "GB", i);
  return s;
}
const ev = (name: string, args: Record<string, unknown>, address: Address = POT): ChainEvent => ({
  name, args, address, blockNumber: 1n, logIndex: 0, txHash: ("0x" + "ee".repeat(32)) as `0x${string}`, live: true,
});

describe("push registration", () => {
  it("accepts a valid EIP-191 signature over the fixed message", async () => {
    const now = 1_760_000_000;
    const deadline = now + 600;
    const signature = await acct.signMessage({ message: pushRegisterMessage(acct.address, TOKEN, deadline) });
    const r = await verifyPushRegistration(fakeClient as never, { address: acct.address.toLowerCase(), expoPushToken: TOKEN, deadline, signature }, now);
    expect(r.address).toBe(acct.address);
    expect(pushRegisterMessage(acct.address, TOKEN, deadline)).toBe(`Plans push notifications\nAddress: ${acct.address}\nToken: ${TOKEN}\nDeadline: ${deadline}`);
  });

  it("rejects wrong signer, expired deadline and malformed tokens", async () => {
    const now = 1_760_000_000;
    const sig = await acct.signMessage({ message: pushRegisterMessage(acct.address, TOKEN, now + 60) });
    await expect(verifyPushRegistration(fakeClient as never, { address: B, expoPushToken: TOKEN, deadline: now + 60, signature: sig }, now)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await expect(verifyPushRegistration(fakeClient as never, { address: acct.address, expoPushToken: TOKEN, deadline: now - 1, signature: sig }, now)).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(verifyPushRegistration(fakeClient as never, { address: acct.address, expoPushToken: "nope", deadline: now + 60, signature: sig }, now)).rejects.toThrow();
  });
});

describe("notification routing", () => {
  it("formats dollars", () => {
    expect(formatUsd(400_000n)).toBe("$0.40");
    expect(formatUsd(1_234_567n)).toBe("$1.23");
    expect(formatUsd(5_000n)).toBe("$0.01");
    expect(formatUsd(-250_000n)).toBe("-$0.25");
  });

  it("asks other active members to approve spends that need approval", () => {
    const s = setup();
    const [n] = notificationsFor(ev("SpendProposed", { id: 4n, proposer: A, amount: 400_000n, category: 3, approvalsRequired: 2 }), s);
    expect(n.to).toEqual([B, C]);
    expect(n.body).toBe("A $0.40 spend (Food & drink) needs your approval.");
    expect(notificationsFor(ev("SpendProposed", { id: 5n, proposer: A, amount: 1n, category: 3, approvalsRequired: 1 }), s)).toEqual([]);
  });

  it("tells pot members about executions, contributions and settlement; payouts go to the payee", () => {
    const s = setup();
    s.setMemberInactive(POT, C);
    expect(notificationsFor(ev("Contributed", { member: A, amount: 250_000n }), s)[0].to).toEqual([B]);
    expect(notificationsFor(ev("Settled", { by: A }), s)[0].to).toEqual([A, B, C]); // exited members too
    expect(notificationsFor(ev("Payout", { member: B, amount: 1n }), s)[0].to).toEqual([B]);
    expect(notificationsFor(ev("SpendExecuted", { id: 9n, amount: 100_000n }), s)[0].to).toEqual([A, B]);
  });

  it("routes Sent to the recipient and Claimed to the link creator", () => {
    const s = setup();
    expect(notificationsFor(ev("Sent", { from: A, to: B, amount: 2_030_000n }, C), s)[0]).toMatchObject({ to: [B], body: "+$2.03" });
    s.insertClaim({ id: 1n, source: A, claimSigner: C, amount: 500_000n, sourceSpendId: 0n });
    expect(notificationsFor(ev("Claimed", { id: 1n, recipient: B }, C), s)[0].to).toEqual([A]);
    // LINK spend from a pot → the spend's proposer
    s.insertProposal({ pot: POT, id: 3n, proposer: C, kind: 1, payee: B, amount: 1n, category: 7, splitMembers: [C], approvalsRequired: 1, expiresAt: 0, status: "executed", createdAt: 0 });
    s.insertClaim({ id: 2n, source: POT, claimSigner: B, amount: 1n, sourceSpendId: 3n });
    expect(notificationsFor(ev("Claimed", { id: 2n, recipient: A }, C), s)[0].to).toEqual([C]);
  });

  it("excludes demo accounts", () => {
    const s = setup();
    const [n] = notificationsFor(ev("Contributed", { member: A, amount: 1n }), s, new Set([C.toLowerCase()]));
    expect(n.to).toEqual([B]);
  });

  it("dispatches to Expo in batches and drops dead tokens", async () => {
    const s = setup();
    s.addPushToken(B, TOKEN);
    s.addPushToken(C, "ExponentPushToken[deaddeaddead]");
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const msgs = JSON.parse(String(init!.body)) as { to: string }[];
      return new Response(JSON.stringify({ data: msgs.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) }));
    });
    const d = new PushDispatcher(s, { enabled: true, url: "https://exp.host/--/api/v2/push/send" }, new Set(), fetchImpl as never);
    d.handle(ev("Contributed", { member: A, amount: 250_000n }));
    d.handle({ ...ev("Contributed", { member: A, amount: 1n }), live: false }); // backfill: ignored
    await d.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.sent).toBe(1);
    expect(s.pushTokens([C])).toEqual([]);
    expect(s.pushTokens([B])).toEqual([{ address: B, token: TOKEN }]);
  });
});
