/**
 * Reviewed findings from Stage A, rendered into REPORT.md. Each one has a scenario in this harness
 * that reproduces it on every run. Nothing under contracts/src, relayer/src or app/ was changed.
 */
export interface Finding {
  id: string;
  title: string;
  where: string;
  severity: string;
  scenario: string;
  body: string;
}

export const FINDINGS: Finding[] = [
  {
    id: "F1",
    title: "[Open] A payout skipped at settlement can never be collected; the money stays locked in the settled pot",
    where: "contracts/src/Pot.sol `settle()` / `_tryPay()` / `_distribute()` (and docs/protocol.md, Ending, step 4)",
    severity: "Medium (funds stuck; needs AUSD to refuse the recipient at that moment, e.g. an Agora freeze)",
    scenario: "`pot H: frozen creditor` → \"settle while a creditor is frozen by AUSD\" (row notes show the follow-up attempts)",
    body: `
**What happens.** \`settle()\` pays each creditor with \`_tryPay\`, which swallows a refused transfer so one recipient cannot block everyone (protocol.md: "a payout whose transfer fails ... is skipped and stays as that member's claim"). On the fork, with real AUSD, bob's account is frozen through AUSD's own flag, the pot settles, alice is paid 20, and bob's 10 is skipped: \`netOf(bob) = +10\`, the pot holds 10, \`Settled.unpaidClaims = 10\`. Then bob is unfrozen. There is no function that pays a positive net after settlement. \`settle\` returns \`CannotSettle\`, \`exit\` returns \`PotSettled\`, and \`payDebt\` is only for negative nets. The only code paths that ever pay a creditor again are \`_distribute\` from someone else's \`payDebt\` or from an escrow refund. With no debtors and no open links, nothing ever runs them, so bob's 10 AUSD is locked in the pot permanently. The same applies to a creditor skipped inside \`_distribute\`.

**Minimal repro** (what the scenario does, all through the relayer):
1. alice \`createPot\` with deposit 20, bob \`join\` with deposit 10, both \`ack\`.
2. Set bob's AUSD frozen bit (\`balance << 8 | 1\` in slot \`keccak256(abi.encode(bob, 0x4557…b700))\`).
3. \`settle\`: Payout(alice, 20), no Payout to bob, pot balance 10, netOf(bob) 10.
4. Clear the frozen bit. \`settle\` → CANNOT_SETTLE, \`exit\`(bob) → POT_SETTLED, \`payDebt\`(bob) → INVALID_AMOUNT. I1 still holds (Σnet = 10 = balance), but the 10 can't leave.

**Proposed fix** (contracts/src is untouched here; the lead decides). Add a permissionless retry after settlement, for example:
\`\`\`solidity
/// Pays a creditor whose payout was skipped, pro rata to what the pot still holds.
function collect(address member) external {
    if (!settled) revert InvalidStatus();
    (uint256 i, bool found) = _indexOf(member);
    int256 n = found ? _members[i].net : int256(0);
    if (n <= 0) revert InvalidAmount();
    uint256 credit; // Σ positive nets
    for (uint256 k; k < memberCount; ++k) if (_members[k].net > 0) credit += uint256(int256(_members[k].net));
    uint256 amount = uint256(n) * ausd.balanceOf(address(this)) / credit;
    if (amount == 0 || !_tryPay(i, amount)) revert InvalidAmount(); // still refused: try later
}
\`\`\`
Pro rata keeps it fair when the pot is also short for other creditors. Add the relayer action (\`collect\`, target pot, no signature needed) and a protocol.md line. If the team would rather not add a function, at least document that a refused payout is lost.`,
  },
  {
    id: "R1",
    title: "[Fixed 7 Oct] The relayer can't decode AUSD's ERC-3009 errors, so a replayed or expired authorisation comes back as \"unrecognised error 0x…\"",
    where: "relayer/src/abi.ts `commonErrorsAbi` and relayer/src/errors.ts `NAMED`",
    severity: "Low (the app hides it behind a generic \"Nothing moved\", but API clients and logs get a raw selector)",
    scenario: "`send` → \"PlansSend replay of a used authorisation\" and `pot A: expiry` → \"contribute with a 3009 authorisation expired onchain\" (both FAIL by design until fixed)",
    body: `
**What happens.** When AUSD rejects a \`receiveWithAuthorization\`, the relayer decodes the revert against its known errors. AUSD's \`InvalidSignature()\` and \`ERC20InsufficientBalance(...)\` are already known and come back in plain English. Two that users can realistically hit are not:

| Selector | Error | When |
|---|---|---|
| \`0x1dbc01d4\` | \`UsedOrCanceledAuthorization()\` | the same 3009 authorisation is submitted twice (a retry after a timeout whose first send landed; a double tap; a replayed \`send\`, \`contribute\`, \`payDebt\` or \`claimCreate\`) |
| \`0xa899ef93\` | \`ExpiredAuthorization()\` | \`validBefore\` has passed on the chain but not yet on the relayer's wall clock (clock skew; slow queue) |

Both return \`422 {code: "REVERTED", message: "The transaction would fail (unrecognised error 0x1dbc01d4)."}\`.

**Minimal repro:** relay a successful \`send\`, then POST the identical body again.

**Proposed fix:**
\`\`\`ts
// relayer/src/abi.ts, commonErrorsAbi
"error UsedOrCanceledAuthorization()",
"error ExpiredAuthorization()",
// relayer/src/errors.ts, NAMED
UsedOrCanceledAuthorization: "This payment was already sent or cancelled. Check your balance before trying again.",
ExpiredAuthorization: "This payment request has expired. Please try again.",
\`\`\`
The codes become \`USED_OR_CANCELED_AUTHORIZATION\` and \`EXPIRED_AUTHORIZATION\`. Add both to the app's \`CODE_COPY\` in app/src/lib/api/relayer.ts. AUSD's "not yet valid" error is not reachable from the app (\`validAfter\` is always 0), so it was not probed.`,
  },
  {
    id: "O1",
    title: "[Fixed 7 Oct] Observation: a plan's startTime taken from the phone's clock can leave a new plan \"not open\" for a few seconds",
    where: "app/src/lib/core/draft.ts `planTimes` (startTime = Date.now())",
    severity: "Low (UX)",
    scenario: "Seen in the first harness run: pots created with startTime = wall clock got SpendBlocked 2 (PLAN_NOT_OPEN) on an immediate propose, because the wall clock was a few seconds ahead of the latest block. The harness now uses block time − 60 s.",
    body: `
\`Pot.initialize\` treats a start in the past as now, but a start in the future is honoured. A phone whose clock runs N seconds ahead of the chain creates a plan that refuses spends for N seconds ("This plan isn't open for spending right now"). **Suggestion:** for plans that start today, send \`startTime = now - 300\` or \`0\`. The pot then uses \`block.timestamp\`, and \`PotCreated\` already carries the effective start.`,
  },
  {
    id: "O2",
    title: "[Fixed 7 Oct] Observation: failed createPot requests still use up the per-IP daily createPot quota",
    where: "relayer/src/app.ts `POST /v1/relay` (takeDaily before relayPrepared)",
    severity: "Low",
    scenario: "`limits` → \"createPot quota (30 per IP per day)\"",
    body: `
The quota is taken before simulation, so 30 createPot requests that revert (bad signature, wrong safety net) block a shared IP (office, carrier NAT) from creating real plans for the rest of the UTC day. **Suggestion:** refund the daily slot (\`store.refundDaily\`) when \`relayPrepared\` throws a \`RelayError\` with status 4xx, as the demo already does for its own quotas.`,
  },
];

export const NOT_COVERED: string[] = [
  "The app UI on a device: screens, passkey/Mera session signing, SecureStore nonces, push. The harness signs with the app's own EIP-712 builders, 3009 nonce bindings and nonce allocator (imported from app/src/lib/chain), but with local throwaway EOAs, not passkeys.",
  "Smart-account signers (ERC-1271, EIP-7702). Only EOA signatures were exercised.",
  "The Envio indexer. It was not run against the fork: it needs Docker/Postgres, and no containers were started.",
  "Real Monad behaviour: block times, Monad's gas pricing and estimator (anvil prices gas like Ethereum, so the gas figures here are anvil's), the reserve-balance rule, and `eth_sendRawTransactionSync` on Monad (anvil 1.5 supports it). Latency figures are local-anvil numbers.",
  "Push notifications (PUSH_ENABLED=false) and `/v1/push/register`. The testnet faucet drip (only the mainnet 404 was checked). The long-stop job (disabled; it uses the wall clock plus a 30-day grace).",
  "Relayer resilience: restarts, nonce-gap and 'already known' recovery, RPC failover, websocket reconnects, concurrent load across lanes. Blob disk cap (507) and the 60/hour blob upload limit.",
  "Demo auto-approvals of pending spends in a plan with demo members (the try-settle-up script only uses instant spends) and the demo's auto-settle 2 minutes after the end.",
  "FX from the real frankfurter.app: a local mock with the same response shape was used so the run is offline-deterministic.",
  "Rule changes beyond payee policy and allowlist (for example, raising minContribution and recomputing who meets it).",
];
