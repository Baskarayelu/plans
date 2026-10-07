# Plans relayer

The relayer submits members' signed Plans actions to Monad and pays the gas, so users never hold MON. It is a convenience, not a gatekeeper: every action is an EIP-712 message or an AUSD ERC-3009 authorisation that anyone can submit, and the contracts enforce the rules.

It also:

- watches chain events and sends push notifications;
- serves a signed reference exchange rate;
- runs a testnet faucet;
- runs the demo members Ben, Asha and Maya;
- settles plans that nobody settled (long-stop).

Stack: TypeScript on Node 24, Hono, viem, zod, and SQLite through Node's built-in `node:sqlite`, so there is no native build step.

## Endpoints

All bodies are JSON. Errors are always `{"error": {"code", "message", ...}}` with a 4xx or 5xx status.

### `POST /v1/relay`

```json
{ "action": "propose", "params": { "pot": "0x…", "proposer": "0x…", "kind": "PAY", "payee": "0x…",
  "amount": "400000", "category": 3, "split": { "members": ["0x…","0x…"], "weights": [1,1] },
  "memo": "0x…", "receiptHash": "0x…", "nonce": "…", "deadline": 1760000000, "sig": "0x…" } }
```

**Params.** They mirror the Solidity arguments one for one; see `src/actions.ts` and `contracts/src/interfaces`.

- Integers can be decimal strings, numbers or 0x-hex.
- Bytes are 0x-hex.
- `bytes2` country and `bytes3` currency fields also accept ISO codes such as `"GB"` or `"GBP"`.
- Enums also accept names: `kind` is `PAY`, `LINK` or `PERSONAL`; `highTier` is `MAJORITY` or `ALL`; `payeePolicy` is `ANYONE`, `MEMBERS_ONLY` or `MEMBERS_AND_ALLOWLIST`; `outcome` is `RESPLIT` or `SPENDERCOVERS`.
- The optional structs `deposit`, `safetyNet` and `keyReg` default to "absent" (value 0).

**Actions by target contract:**

| Target | Actions |
|---|---|
| PlansFactory | `createPot` |
| Pot (only if `factory.isPot(pot)`) | `join`, `contribute`, `propose`, `vote`, `cancelSpend`, `execute`, `expire`, `openDispute`, `resolveDispute`, `voteDispute`, `finalizeDispute`, `freeze`, `voteUnfreeze`, `proposeRules`, `voteRules`, `applyRules`, `exit`, `ack`, `settle`, `payDebt`, `collect`, `rotateInvite`, `postKeyWraps` |
| KeyRegistry | `registerKey` (`account`, `pubKey`, `deadline`, `sig`) |
| PlansSend | `send` (`from`, `meta`, `auth`); `meta.fxRoundId` is optional (default `0`) |
| ClaimEscrow | `claimCreate` (calls `createWithAuthorization`), `claim`, `claimRefund` (calls `refund`) |

**`collect`** (`{ "pot": "0x…", "member": "0x…" }`). After settlement, pays `member`, and only `member`, what the pot still owes them: the whole positive net when the pot covers every positive net, otherwise a pro-rata share. It is unsigned and permissionless like `settle`, because it can only ever pay `member`; the per-address rate limit applies to `member`. Use it when a payout was skipped at settlement, for example because AUSD refused a frozen account (the `Settled` event's `unpaidClaims` is then above 0). Decoded errors: `NOT_SETTLED`, `NOT_MEMBER`, `NOTHING_TO_COLLECT`, `PAYOUT_REFUSED` (AUSD still refuses; the claim is kept, try later) and `INSUFFICIENT_GAS`. A success emits `Payout` and `Collected(member, by, amount)`.

**`send` and `meta.fxRoundId`.** `meta` is `{ to, fromCountry, toCountry, fromCurrency, toCurrency, fxRateE8, fxTimestamp, fxRoundId, memoHash, salt }`, in that order. `fxRoundId` is the FxReference round the app quoted from, or `0` for none, and defaults to `0` when absent so older clients still validate. The ERC-3009 nonce is `keccak256(abi.encode(meta))` over all ten fields, so the app must send exactly the `fxRoundId` it hashed: a different value fails as a bad authorisation. With a round, the contract records the round's reference rate (`refRateE8`) and the applied rate's difference from it (`fxDiffBps`) in `Sent`; it never changes the amount. A round that doesn't exist, is more than 6 hours old (by its scheduled time) or lacks either currency reverts as `FX_ROUND_UNKNOWN`, `FX_ROUND_STALE` or `FX_PAIR_UNAVAILABLE`.

**Pipeline:**

1. Validate the body with zod.
2. Check the target against the allowlist.
3. Simulate with `eth_call`, then Monad's `eth_estimateGas`, both from the sending lane, on the configured Monad RPC.
4. Set the gas limit to that estimate plus a small margin. An estimate above the action's cap is refused (`GAS_CAP_EXCEEDED`); the cap is never used as the limit.
5. Send with `eth_sendRawTransactionSync` (EIP-7966). If the RPC times out (error code 4), wait for the receipt. If the method is missing, fall back to `eth_sendRawTransaction` and poll for the receipt.

**Success response (200):**

```json
{ "action": "vote", "txHash": "0x…", "blockNumber": "123", "status": "success", "gasUsed": "84211",
  "gasLimit": "102632", "latencyMs": 412, "totalMs": 590, "lane": 1, "sync": true,
  "events": [{ "address": "0x…", "name": "Voted", "logIndex": 0, "args": { "id": "4", "member": "0x…", "approve": true } },
             { "name": "SpendExecuted", "args": { … } }] }
```

`status: "reverted"` (still HTTP 200) means the transaction was included but failed, because state changed after the simulation.

**Error statuses:**

| Status | Meaning | Body |
|---|---|---|
| 400 | Invalid JSON or params | `code: "INVALID_PARAMS"` and `issues: [{ path, message }]` |
| 403 | Target not allowed | `code: "TARGET_NOT_ALLOWED"` |
| 413 | Body too large | |
| 422 | The simulation reverted. The custom error is decoded into `code`, `message`, `error` (the Solidity error name) and `revertData`. | `{ "code": "OVER_CATEGORY_BUDGET", "reason": 6, "error": "SpendBlocked", "message": "This would go over the plan's budget for this category." }` |
| 422 | Expired | `EXPIRED` |
| 422 | Gas cap exceeded | `GAS_CAP_EXCEEDED` |
| 429 | Rate limited | Includes a `retry-after` header |
| 502 / 503 | RPC or relayer funding problem | |

Every `SpendBlocked` reason code from `docs/protocol.md` (1–11) has its own `code` and message. Every other custom error is decoded by name into an UPPER_SNAKE `code` (`NotSettled` → `NOT_SETTLED`, `FxRoundStale` → `FX_ROUND_STALE`) with a plain-English message. See `src/errors.ts`.

### `GET /v1/health`

Returns:

- chain ID (and the expected one) and the latest block;
- whether `eth_sendRawTransactionSync` is supported;
- each lane's address, nonce, queue, busy flag, MON balance, low-balance flag, sent/failed counts and last error;
- contract addresses;
- listener cursor, head, websocket state and known pot count;
- push, faucet, demo and long-stop status.

The status is 503 when the RPC is down, the chain ID is wrong, or every lane is below `LANE_MIN_BALANCE_WEI`.

### `GET /v1/tx/:hash`

Timing for any transaction this relayer sent: relayed actions, demo actions, faucet and long-stop. A row is stored in SQLite at send time and kept forever. The receiving phone uses it to show "Settled in 0.6 s".

```json
{ "txHash": "0x…", "action": "send", "latencyMs": 412, "totalMs": 598, "blockNumber": "123",
  "status": "success", "submittedAt": 1760000000123 }
```

| Field | Meaning |
|---|---|
| `latencyMs` | From handing the signed transaction to the RPC until the receipt |
| `totalMs` | From the relay request arriving until the receipt (includes validation and simulation) |
| `submittedAt` | Unix milliseconds when the transaction was sent |

Returns 404 `NOT_FOUND` for hashes this relayer didn't send, and 400 for a malformed hash.

### Encrypted blobs: `PUT /v1/blobs/:sha256`, `GET /v1/blobs/:sha256`

A content-addressed store for receipt photos. The app encrypts with the group key and uploads only ciphertext; the server never sees keys. `:sha256` is the lowercase hex sha256 of the ciphertext bytes (a `0x` prefix is accepted).

**Upload.** `PUT` accepts either form:

- `Content-Type: application/json` with body `{"data": "<base64url ciphertext>"}`. Standard base64 and padding are tolerated.
- `Content-Type: application/octet-stream` with the raw bytes.

The server decodes the body, recomputes sha256 over the decoded bytes, and stores the file at `<BLOB_DIR>/<aa>/<bb>/<sha256>` with an atomic write.

| Status | Meaning |
|---|---|
| 201 | Stored: `{ "sha256", "size", "created": true }` |
| 200 | Already stored, and the body still matched: `created: false` |
| 400 | `HASH_MISMATCH`, `INVALID_HASH`, `INVALID_BASE64`, `EMPTY_BODY` or missing `data` |
| 413 | Over 2 MB of decoded bytes (`BLOB_MAX_BYTES`). JSON request bodies may be up to about 2.8 MB. |
| 415 | Any other content type |
| 429 | Over 60 new uploads per IP per hour (re-uploads of existing blobs don't count) |
| 507 | `STORAGE_FULL`: the disk cap (`BLOB_DISK_CAP_BYTES`, default 2 GB) is reached |

**Download.** `GET` returns `{"data": "<base64url, unpadded>"}` when the `Accept` header includes `application/json`, which is what the app sends. Otherwise it returns the raw bytes as `application/octet-stream`. Both carry `Cache-Control: public, max-age=31536000, immutable`, `Vary: Accept` and an ETag (which differs between the two forms), and `If-None-Match` gives 304. Unknown ids return 404.

### `GET /v1/fx/round`

The latest round of the onchain FxReference (written by the Chainlink CRE workflow), read with one `eth_call` and cached for 15 s. The relayer never writes to FxReference. The address is `FX_REFERENCE_ADDRESS`, or `factory.fxReference()` when unset; without one the endpoint returns 404 `FX_REFERENCE_DISABLED`.

```json
{ "fxReference": "0x…", "roundId": "12", "scheduledTime": 1791270000, "writtenAt": 1791270004, "rateDate": 20261007,
  "sourceMask": 7, "usdPerUnitE8": { "GBP": "134000000", "INR": "1130000" }, "sourceMasks": { "GBP": 3, "INR": 3 },
  "ageSec": 120, "maxAgeSec": 21600, "fresh": true }
```

Rates are USD per 1 unit, 8 decimals; currencies absent from the round are left out. `roundId` is `"0"` before the first round. A send quoted from this round passes `fxRoundId` while `fresh` is true (at most 6 hours after `scheduledTime`).

### `GET /v1/fx?from=GBP&to=USD`

Returns a reference rate from ECB rates (frankfurter.app), cached for 10 minutes. AUSD is treated as USD.

```json
{ "from": "GBP", "to": "USD", "rate": "1.3225", "rateE8": "132250000", "timestamp": 1791270666, "date": "2026-10-05",
  "source": "ECB reference rates via frankfurter.app", "signer": "0x…", "message": "…", "signature": "0x…" }
```

`signature` is EIP-191 (`personal_sign`) over `message`. The app can check `recoverMessageAddress(message, signature) == signer` and compare `signer` with the relayer's lane 0 address from `/v1/health`. The message format is:

```
Plans FX reference
Pair: GBP/USD
RateE8: 132250000
Timestamp: 1791270666
Date: 2026-10-05
Source: ECB reference rates via frankfurter.app
```

`rateE8` and `timestamp` go straight into `PlansSend.SendMeta.fxRateE8` and `fxTimestamp`.

### `POST /v1/faucet` (testnet only)

Body: `{ "address": "0x…" }`. Sends `FAUCET_AMOUNT` (25 AUSD by default) from lane 0.

- Lane 0 refills itself from the public testnet faucet (`requestFunds`, 10,000 AUSD, at most once a minute).
- Limits: 1 request per address and 3 per IP per UTC day.
- Always 404 on mainnet (chain 143), whatever the env says.

### `POST /v1/push/register`

```json
{ "address": "0x…", "expoPushToken": "ExponentPushToken[…]", "deadline": 1760000000, "signature": "0x…" }
```

`signature` is EIP-191 `personal_sign` by `address` over exactly this message (checksummed address):

```
Plans push notifications
Address: 0xAbC…
Token: ExponentPushToken[…]
Deadline: 1760000000
```

The deadline must be in the future and at most 24 h ahead. Smart accounts are verified through ERC-1271/6492 via viem's `verifyMessage`. A token belongs to the latest address that registered it, and each address keeps up to 5 tokens. Expo `DeviceNotRegistered` receipts remove the token.

**Notifications sent.** Texts carry no memos, since memos are encrypted to the group.

| Event | Recipients | Text |
|---|---|---|
| `SpendProposed` with `approvalsRequired > 1` | The other active members | "Approval needed" |
| `SpendExecuted` | Active members except the proposer | |
| `Contributed` | The other active members | |
| `Settled` | Every member, including those who exited | Mentions payouts still owed when `unpaidClaims > 0` |
| `Payout` | The member who was paid (settlement, exit, debt distribution or `collect`) | `Collected` sends nothing extra: `collect` also emits `Payout` |
| `Sent` | The recipient | |
| `Claimed` | The link's creator: the sender, or for a pot LINK spend, its proposer | |

Demo accounts never receive pushes. History replayed during backfill never triggers pushes.

### Demo

| Endpoint | Purpose |
|---|---|
| `GET /v1/demo/accounts` | `{ enabled, accounts: [{name, city, country, address}], pots: [{pot, stage, createdAt}] }`. The indexer and stats page use it to exclude demo accounts and demo pots. |
| `POST /v1/demo/try-settle-up` | Body: `{ "member": "0xJudge", "meta"?, "inviteKeyWrap"?, "creatorKeyWrap"?, "inviteSecret"?, "memos"?: ["0x…"] }`. Returns `{ pot, inviteSecret, inviteSigner, creator, startTime, endTime, rules, demoMembers, txHash, latencyMs }`. |
| `GET /v1/demo/try-settle-up/:pot` | Run status: `{ stage, step, stepIndex, totalSteps, lastError }`. |

**"Try a settle-up" run:**

1. Maya creates a short plan: instant spends up to $0.25, one approval up to $1, review window 0, ending 15 minutes from now.
2. The app joins the judge itself, signing `Join` with the judge's key and `Invite(judge)` with `inviteSecret`.
3. When `MemberJoined(judge)` appears:
   - Maya contributes $0.10.
   - Ben joins and contributes $0.10.
   - Asha joins and contributes $0.10.
   - Ben is reimbursed $0.12 (Food & drink) and Asha $0.08 (Getting around), each split four ways including the judge.
   - Maya records a $0.06 personal spend split with the judge.
   - All three demo members ack.
4. The stage becomes `ready` and the judge can press Settle up. If nobody settles, the relayer settles 2 minutes after the end time.

Total demo deposits are capped at `DEMO_MAX_OUTLAY` ($0.30). Runs are limited to 3 per judge and 10 per IP per UTC day.

If the app doesn't send `meta`, the plan's meta is plaintext JSON prefixed with a `0x00` version byte: `{"v":0,"name":"Try a settle-up","emoji":"🧾","demo":true}`. To show encrypted meta and memos instead, the app can send its own `meta`, `inviteKeyWrap` and `memos` (up to 3), together with the `inviteSecret` it sealed them to.

**Behaviour in any plan a demo member belongs to:**

- **Approvals.** A pending spend up to `DEMO_APPROVE_CAP` ($1) that a demo member hasn't voted on gets an approval after a random 3–8 s delay. Only one demo vote is in flight per proposal.
- **Acks.** Demo members ack once the plan's end time passes, or once any human member has acked in the current ack epoch.

Every demo action is signed with that member's own key and goes through the same `Relayer.relay()` path as the app: validation, allowlist and simulation.

## Event listener

- **Matching.** Logs are matched by topic (every Plans event signature), so pots created later are covered without resubscribing. A log is kept only if it comes from the factory, a pot recorded from `PotCreated`, ClaimEscrow or PlansSend.
- **Sources:**
  - startup backfill from `START_BLOCK` in 100-block `eth_getLogs` chunks;
  - a websocket `logs` subscription;
  - a polling loop that advances a cursor persisted in SQLite and fills any gaps;
  - the receipts of transactions the relayer sends itself.
- **Processing.** Events are deduplicated by `(txHash, logIndex)` and applied idempotently.

## Keys, gas and lanes

- **Keys.** `RELAYER_KEYS` holds comma-separated private keys, one nonce lane each (3 recommended). Each lane serialises its own sends, and lanes run in parallel. New work goes to the least-loaded lane with enough MON. This spreads load under Monad's reserve-balance rule (per-sender gas over 3 blocks is capped at min(10 MON, balance)). Never EIP-7702-delegate these keys.
- **Nonce recovery.**
  - On "nonce too low" or a nonce gap, the lane resyncs from the chain and retries.
  - On "already known", it waits for the receipt.
  - On any other ambiguous error, it checks for the receipt and the chain nonce before giving up.
- **Gas.** Monad charges the gas limit, not gas used, and prices cold state differently from Ethereum, so the limit is Monad's `eth_estimateGas` for the exact transaction `× 1.10 + 10,000` (`GAS_MARGIN_BPS`, `GAS_MARGIN_FIXED`). This is enforced in code: `LanePool.submit()` only accepts a `MonadGasLimit`, which only `MonadGasEstimator.limitFor()` can create (it calls `eth_estimateGas` on the pool's RPC) and which is bound to that RPC client and to the exact sender, target, calldata and value. Per-action caps (`src/gas.ts`; `GAS_CAPS` overrides) only reject an estimate that is too high. `test/unit/monad-gas.test.ts` checks every sent transaction against the estimate made for it, and `test/unit/gas-sources.test.ts` fails on any new hard-coded `gas:` or send path. The fee is `maxPriorityFee = 2 gwei` and `maxFee = 1.25 × max(baseFee, 100 gwei) + tip`.
- **Logging.** Keys come only from env and are wrapped so that they serialise as `[redacted]`. They are never logged.

## Run locally

```bash
pnpm install
cp .env.example .env   # fill in RELAYER_KEYS, FACTORY_ADDRESS, PLANS_SEND_ADDRESS, …
pnpm dev               # tsx watch, reads .env
# or
pnpm build && pnpm start
```

Against a local anvil chain, with contracts built in `../contracts`:

```bash
anvil --code-size-limit 131072   # Pot's runtime is ~29 KB; Monad allows 128 KB, anvil defaults to 24 KB
```

Then deploy `MockAUSD`, `KeyRegistry`, `FxReference(owner, simForwarder, simTransmitter, chainSelector)`, `PlansFactory(ausd, keyRegistry, fxReference)` and `PlansSend(ausd, fxReference)`, set `CHAIN_ID=31337` and `RPC_URL`/`WS_URL`, and `pnpm dev`. `test/integration/helpers.ts` has a `deployAll()` that does this.

## Tests

```bash
pnpm test               # everything
pnpm test:unit          # no chain needed
pnpm test:integration   # spawns anvil, deploys ../contracts/out artifacts + MockAUSD
```

- **Unit tests** cover validation, revert decoding, the gas policy, fees, nonce lanes (with a scripted RPC), FX signing and caching, rate limits, demo scheduling, push routing and the HTTP layer.
- **Integration tests** cover createPot → join → propose → vote → ack → settle over HTTP, decoded errors (`INVALID_INVITE`, `SpendBlocked(9)`, `CANNOT_SETTLE`), `send` with and without an FxReference round (`FX_ROUND_UNKNOWN`, `FX_ROUND_STALE`), `collect` after a payout AUSD refused at settlement (`NOT_SETTLED`, `PAYOUT_REFUSED`, `NOTHING_TO_COLLECT`), push dispatch, demo approvals and acks, the full "Try a settle-up" run, the faucet and the long-stop job.
- **Skipping.** The integration suite skips with a warning if `contracts/out` lacks the artifacts. Build them with `forge build` in `../contracts`.

When the contracts change, run `forge build` in `../contracts` and then `pnpm sync-abi`. This regenerates `src/abi.errors.generated.json` (every custom error) for revert decoding. The typed ABIs in `src/abi.ts` are hand-copied from `contracts/src/interfaces/*.sol`; keep them in sync.

## Deploy on Railway

1. Create a service from this directory (root `relayer/`). `railway.json` builds the `Dockerfile` (node:24-slim).
2. Add a **volume** mounted at `/data`. The SQLite state lives there (push tokens, daily quotas, the listener cursor, demo runs and sent-transaction timings), and so do the encrypted blobs in `/data/blobs`. Size the volume for `BLOB_DISK_CAP_BYTES` (2 GB by default) plus some headroom.
3. Keep it at **one replica**. Nonce lanes and SQLite are single-writer.
4. Set the variables from `.env.example`. At minimum:
   - `CHAIN_ID`
   - `RELAYER_KEYS`
   - `FACTORY_ADDRESS`
   - `PLANS_SEND_ADDRESS`
   - `START_BLOCK` (the factory's deploy block)
   - for the demo: `DEMO_ENABLED=true` and `DEMO_KEY_BEN`, `DEMO_KEY_ASHA`, `DEMO_KEY_MAYA`

   `PORT` is provided by Railway.
5. **Fund the accounts:**
   - Each relayer key needs MON. Watch `/v1/health` for `lowBalance`.
   - On mainnet, the demo accounts need a few dollars of AUSD; Maya needs about $5 for the demo video.
   - On testnet, the relayer tops the demo accounts up from the faucet at startup.
6. The deploy healthcheck is `/` (liveness). Point monitoring at `/v1/health`, which returns 503 when unhealthy.

## Files

| Path | Purpose |
|---|---|
| `src/actions.ts` | zod schemas and calldata for every action |
| `src/relay.ts` | Allowlist, simulation, gas and send pipeline |
| `src/lanes.ts` | Key lanes, nonces, sync send and fallback |
| `src/errors.ts` | Revert decoding and friendly messages |
| `src/listener.ts` | Backfill, websocket and polling listener |
| `src/push.ts` | Push registration, routing and the Expo dispatcher |
| `src/fx.ts` | Signed FX reference; read-only FxReference latest round |
| `src/faucet.ts` | Testnet faucet |
| `src/demo/` | Demo members (`policy.ts` is the pure decision logic) |
| `src/longstop.ts` | Long-stop settlement |
| `src/store.ts` | SQLite state, including sent-transaction timings |
| `src/blobs.ts` | Encrypted blob store |
| `src/app.ts` | Hono routes, CORS, body limit and rate limits |
| `src/services.ts` | Wiring |
| `src/index.ts` | Server entrypoint |
