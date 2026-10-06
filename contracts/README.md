# Plans contracts

Solidity contracts for Plans: shared trip and household pots in AUSD on Monad. Behaviour is specified in [`../docs/protocol.md`](../docs/protocol.md); the interfaces in `src/interfaces/` define the exact functions, events and EIP-712 types.

| Contract | What it does |
|---|---|
| `PlansFactory` | Deploys one `Pot` clone (ERC-1167, CREATE2) per plan from the creator's signed `CreatePot`, and registers it. Its constructor deploys `ClaimEscrow` and the `Pot` implementation. |
| `Pot` | One plan: members, deposits (ERC-3009), spending rules, proposals and votes, disputes, freeze, rule changes and settlement. It has no admin and is not upgradeable. |
| `ClaimEscrow` | AUSD locked against a one-time claim key (LINK spends and send-by-link). The key holder claims with a signature, and the money is refundable to its source after expiry. |
| `KeyRegistry` | Account → X25519 public key, set with the account's EIP-712 signature. |
| `PlansSend` | Person-to-person AUSD send with an onchain receipt. The ERC-3009 nonce commits to the receipt fields. |

Toolchain: Foundry 1.5, solc 0.8.28, `via_ir`, optimizer 200 runs, EVM `prague` (see `foundry.toml`).

## Build and test

```shell
forge build
forge test                                     # everything, including fork tests
forge test --match-path 'test/fork/*' -vv      # fork tests only (real AUSD)
forge test --match-path test/Deploy.t.sol -vv  # deploy script tests
SKIP_FORK_TESTS=true forge test                # never touch the network
forge fmt
```

Fork tests (`test/fork/ForkLifecycle.t.sol`, `test_run_monadFork` in `test/Deploy.t.sol`) fork Monad mainnet (`monad`) and testnet (`monad_testnet`) through the `[rpc_endpoints]` in `foundry.toml`. If the RPC can't be reached, or `SKIP_FORK_TESTS=true` is set, the suite is reported as skipped instead of failing, so `forge test` passes offline. They run the full lifecycle against the real AUSD:

- create, join with deposit, permit and key
- instant and approved PAY spends
- a LINK spend and its claim
- `PlansSend`
- send-by-link
- settle, with a debt pulled through the permit allowance
- a front-run (already used) permit

forge-std `deal` cannot set AUSD balances. The tests write AUSD's ERC-7201 storage directly instead: the balance mapping at `0x4557…b700`, with values packed as `balance << 8 | isFrozen`, and `totalSupply` at `…b702`.

The Pot runtime is about 29 KB. That is above EIP-170's 24 KB but below Monad's 128 KB limit. `forge test` and `forge script` in Foundry 1.5 accept it as is. A local **anvil must be started with `--code-size-limit 131072`** (or `--disable-code-size-limit`), or the factory deployment reverts.

## Deploy

`script/Deploy.s.sol` deploys through the canonical CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` (calldata = `salt ++ initcode`), with fixed salts:

| Contract | How | Salt |
|---|---|---|
| `KeyRegistry()` | CREATE2 | `keccak256("plans.v1.KeyRegistry")` |
| `PlansSend(ausd)` | CREATE2 | `keccak256("plans.v1.PlansSend")` |
| `PlansFactory(ausd, keyRegistry)` | CREATE2 | `keccak256("plans.v1.PlansFactory")` |
| `ClaimEscrow(ausd)` | CREATE by the factory constructor, nonce 1 | – |
| `Pot(ausd, keyRegistry, claimEscrow)` (implementation) | CREATE by the factory constructor, nonce 2 | – |

- **What the addresses depend on:** the salts, the exact compiled bytecode (source and compiler settings, including the metadata hash) and the AUSD address. They do not depend on the deployer account.
- **AUSD by chain:** chain 143 uses `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, chain 10143 uses `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, and local chain 31337 takes `AUSD=<address>` from the environment.
- **Re-runs:** a contract whose address already has code is skipped, so re-running the script is safe and sends no transactions once everything exists.

```shell
# Dry run (simulation only, no transactions). Any --sender works.
forge script script/Deploy.s.sol --rpc-url monad_testnet --disable-code-size-limit --sender 0x000000000000000000000000000000000000dEaD
forge script script/Deploy.s.sol --rpc-url monad         --disable-code-size-limit --sender 0x000000000000000000000000000000000000dEaD

# Monad testnet (10143)
forge script script/Deploy.s.sol --rpc-url monad_testnet --disable-code-size-limit --broadcast \
  --account deployer --sender $DEPLOYER        # or: --private-key $PRIVATE_KEY

# Monad mainnet (143)
forge script script/Deploy.s.sol --rpc-url monad --disable-code-size-limit --broadcast \
  --account deployer --sender $DEPLOYER        # or: --private-key $PRIVATE_KEY

# Local rehearsal on an anvil fork of mainnet (keeps chain id 143). Anvil account 0's key.
anvil --fork-url https://rpc.monad.xyz --code-size-limit 131072 --port 8547
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8547 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Notes:

- **Cost.** The deployment is three transactions to the CREATE2 deployer, using about 0.36 M, 0.34 M and 8.3 M gas. Monad charges the gas *limit*, and forge sets the limit to its estimate × 130 %. Pass `--gas-estimate-multiplier 110` to pay less.
- **Output file.** With `--broadcast` the script writes `deployments/<chainid>.json`: `chainId`, `ausd`, `keyRegistry`, `plansSend`, `plansFactory`, `claimEscrow`, `potImplementation`, `create2Deployer` and `salts`. When the RPC is a local anvil node it writes `deployments/<chainid>-anvil.json` instead, so a rehearsal never overwrites the real file. A dry run only logs the addresses.
- **Confirm the deployment landed.** Forge writes the file while it runs the script, before the transactions are mined. Re-run the dry run afterwards: each contract should log `already deployed at`.

Example `deployments/143.json`:

```json
{
  "ausd": "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  "chainId": 143,
  "claimEscrow": "0x…",
  "create2Deployer": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  "keyRegistry": "0x…",
  "plansFactory": "0x…",
  "plansSend": "0x…",
  "potImplementation": "0x…",
  "salts": { "keyRegistry": "0xb21d…415f", "plansFactory": "0x3aa3…0662", "plansSend": "0x3e89…2641" }
}
```

## Verify

All five contracts must be verified, including `ClaimEscrow` and the `Pot` implementation, which the factory constructor creates. Run the commands from the same source and `foundry.toml` that were deployed; forge reads the compiler settings from `foundry.toml`.

```shell
CHAIN=143   # or 10143
D=deployments/$CHAIN.json
AUSD=$(jq -r .ausd $D); KR=$(jq -r .keyRegistry $D); PS=$(jq -r .plansSend $D)
PF=$(jq -r .plansFactory $D); CE=$(jq -r .claimEscrow $D); PI=$(jq -r .potImplementation $D)
```

**`MONADSCAN_API_KEY` and the Sourcify verifier.** `foundry.toml` has an `[etherscan] monad` entry whose key is `${MONADSCAN_API_KEY}`. This has two effects in forge 1.5:

- Every `verify-contract` fails if that variable is unset.
- If the variable is non-empty, forge silently switches `--verifier sourcify` to Etherscan for chain 143.

So set it to an empty string for Sourcify.

### MonadVision (Sourcify)

```shell
export MONADSCAN_API_KEY=
SV=(--chain $CHAIN --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --watch)

forge verify-contract $KR src/KeyRegistry.sol:KeyRegistry  "${SV[@]}"
forge verify-contract $PS src/PlansSend.sol:PlansSend      "${SV[@]}"
forge verify-contract $PF src/PlansFactory.sol:PlansFactory "${SV[@]}"
forge verify-contract $CE src/ClaimEscrow.sol:ClaimEscrow  "${SV[@]}"
forge verify-contract $PI src/Pot.sol:Pot                  "${SV[@]}"
```

Sourcify matches against the onchain bytecode, so it needs no constructor arguments. Check the result at `https://sourcify-api-monad.blockvision.org/v2/contract/$CHAIN/<address>`.

### Monadscan (Etherscan v2)

In forge 1.5, `--verifier etherscan --chain 143` fails with "No known Etherscan API URL for chain `143`", even with the `url` in `foundry.toml`. Use the Etherscan-compatible `custom` verifier with the v2 endpoint instead:

```shell
export MONADSCAN_API_KEY=<your Etherscan v2 key>
EV=(--chain $CHAIN --verifier custom --verifier-url "https://api.etherscan.io/v2/api?chainid=$CHAIN" --verifier-api-key $MONADSCAN_API_KEY --watch)

forge verify-contract $KR src/KeyRegistry.sol:KeyRegistry "${EV[@]}"
forge verify-contract $PS src/PlansSend.sol:PlansSend "${EV[@]}" \
  --constructor-args $(cast abi-encode "constructor(address)" $AUSD)
forge verify-contract $PF src/PlansFactory.sol:PlansFactory "${EV[@]}" \
  --constructor-args $(cast abi-encode "constructor(address,address)" $AUSD $KR)
forge verify-contract $CE src/ClaimEscrow.sol:ClaimEscrow "${EV[@]}" \
  --constructor-args $(cast abi-encode "constructor(address)" $AUSD)
forge verify-contract $PI src/Pot.sol:Pot "${EV[@]}" \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $AUSD $KR $CE)
```

## Gas

See GAS.md.
