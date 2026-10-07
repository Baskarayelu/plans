/** Demo members and "Try a settle-up", end to end, the way the app drives it. */
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { net, potRead, waitFor } from "../lib/harness";
import { ausdBal } from "../lib/harness";
import { build, findEvent, findEvents } from "../lib/plans";
// The app's own demo join amounts (app/src/app/demo/index.tsx joins with these).
import { DEMO_SAFETY_NET, demoDeposit } from "../../../app/src/lib/ending/demo";
import type { T } from "./types";

export async function demoScenarios({ R, env, A }: T) {
  R.group = "demo";
  const api = env.api;

  await R.run("GET /v1/demo/accounts", "http", "enabled, Ben/Asha/Maya with their addresses", async (s) => {
    const r = await api.get("/v1/demo/accounts");
    s.eq(r.body.enabled, true, "enabled");
    const by = Object.fromEntries(r.body.accounts.map((a: { name: string; address: string }) => [a.name, getAddress(a.address)]));
    s.eq(by, { Ben: A.demo.ben.address, Asha: A.demo.asha.address, Maya: A.demo.maya.address }, "accounts");
    s.actual = "enabled, 3 accounts";
  });

  await R.run("try-settle-up for a demo account", "failure", "400 INVALID_MEMBER", async (s) => {
    const r = await s.rejects(() => api.postJson("/v1/demo/try-settle-up", { member: A.demo.ben.address }), { status: 400, code: "INVALID_MEMBER" });
    s.actual = `400 INVALID_MEMBER: "${r.body.error!.message}"`;
  });

  let pot: Address | undefined;
  await R.run("try-settle-up end to end (create, judge joins, script runs, judge acks and settles)", "flow", "pot created by Maya, 11 scripted steps, ready, Settled, run done", async (s) => {
    const t0 = Date.now();
    const r = await api.postJson("/v1/demo/try-settle-up", { member: A.judge.address });
    s.eq(r.status, 200, `start (${JSON.stringify(r.body.error ?? "")})`);
    pot = getAddress(r.body.pot as string);
    env.pots.set(pot, "demo");
    env.demoPots.add(pot.toLowerCase());
    env.tracked.set(pot.toLowerCase(), "demo:pot");
    s.txs.push(r.body.txHash as Hex);
    s.latency.push({ action: "demo createPot", latencyMs: r.body.latencyMs as number, clientMs: r.clientMs });
    s.eq(getAddress(r.body.creator as string), A.demo.maya.address, "creator is Maya");
    const invite = privateKeyToAccount(r.body.inviteSecret as Hex);
    s.eq(invite.address, getAddress(r.body.inviteSigner as string), "invite signer matches secret");

    // The app joins the judge itself: Join signed by the judge, Invite signed with the invite secret,
    // with the app's demo deposit and safety-net permit.
    const deposit = demoDeposit(await ausdBal(env, A.judge.address));
    s.eq(deposit, 100_000n, "app demo deposit");
    const j = s.ok(await api.relay("join", await build.join(env.ctx, pot, A.judge, invite, { country: "FR", deposit, safetyNet: DEMO_SAFETY_NET })), "MemberJoined", "Contributed");
    s.eq(findEvent(j, "MemberJoined")!.args.member, A.judge.address, "joined member");

    const st = await waitFor(async () => {
      const x = await api.get(`/v1/demo/try-settle-up/${pot}`);
      if (x.body.stage === "failed") throw new Error(`demo run failed: ${x.body.lastError}`);
      return x.body.stage === "ready" ? x.body : undefined;
    }, "demo run ready", 180_000, 300);
    s.eq(st.stepIndex, 11, "all 11 steps done");
    s.eq(Number(await potRead(env, pot, "activeMemberCount")), 4, "Maya, Ben, Asha and the judge");
    s.eq(Number(await potRead(env, pot, "spendCount")), 3, "three scripted spends");

    s.ok(await api.relay("ack", await build.ack(env.ctx, pot, A.judge)), "Acked");
    s.eq(await potRead(env, pot, "canSettle"), true, "canSettle after the judge's ack");
    const settle = s.ok(await api.relay("settle", { pot }), "Settled");
    s.note(`Settled: ${JSON.stringify(findEvent(settle, "Settled")!.args)}; payouts ${findEvents(settle, "Payout").length}, debts ${findEvents(settle, "DebtRecorded").map((e) => `${e.args.member}=${e.args.amount}`).join(", ") || "none"}`);
    s.eq(findEvents(settle, "DebtRecorded").length, 0, "no debts after the app-style join");
    s.eq(await net(env, pot, A.judge.address), 0n, "judge net after settle");
    const done = await waitFor(async () => {
      const x = await api.get(`/v1/demo/try-settle-up/${pot}`);
      return x.body.stage === "done" ? x.body : undefined;
    }, "demo run done", 30_000);
    s.eq(done.stage, "done", "stage");
    const tx = await api.get(`/v1/tx/${settle.body.txHash}`);
    s.eq([tx.status, tx.body.action], [200, "settle"], "/v1/tx lookup of the settle");
    s.actual = `ready after ${Math.round((Date.now() - t0) / 1000)} s, settled, stage done`;
  });

  await R.run("try-settle-up quota per judge (3 per day)", "failure", "4th start for one judge -> 429 DEMO_LIMIT", async (s) => {
    for (let i = 2; i <= 3; i++) {
      const r = await api.postJson("/v1/demo/try-settle-up", { member: A.judge.address });
      s.eq(r.status, 200, `start ${i}`);
      const p = getAddress(r.body.pot as string);
      env.pots.set(p, `demo-extra-${i}`);
      env.demoPots.add(p.toLowerCase());
      env.tracked.set(p.toLowerCase(), `demo:pot-extra-${i}`);
      s.txs.push(r.body.txHash as Hex);
    }
    const r = await s.rejects(() => api.postJson("/v1/demo/try-settle-up", { member: A.judge.address }), { status: 429, code: "DEMO_LIMIT" });
    s.actual = `starts 2 and 3 ok; 4th -> 429 DEMO_LIMIT: "${r.body.error!.message}"`;
  });

  await R.run("GET /v1/demo/try-settle-up unknown pot", "failure", "404 NOT_FOUND", async (s) => {
    const r = await api.get(`/v1/demo/try-settle-up/${A.stranger}`);
    s.eq([r.status, r.body.error?.code], [404, "NOT_FOUND"], "status/code");
    s.actual = "404 NOT_FOUND";
  });

  await R.invariants("demo");
}
