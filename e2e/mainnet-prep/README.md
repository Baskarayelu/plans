# Mainnet launch rehearsal (anvil fork)

Runs every mainnet launch script from [`docs/mainnet-launch.md`](../../docs/mainnet-launch.md) against a local anvil fork of Monad mainnet (chain 143, real AUSD), each as `check` then `send --confirm <fingerprint>`, and asserts the result onchain.

## Run

```shell
node e2e/mainnet-prep/run.mjs
```

Takes about 2 minutes. Exit code 0 only if every assertion passes. It writes `e2e/mainnet-prep/results.json` (no secrets: throwaway addresses and fork-only data). `KEEP=1` keeps the temp work dir (keys file, logs, links file); it is deleted on success otherwise.

Prerequisites (once):

```shell
cd contracts
forge build
cd ..
npm --prefix contracts/tools install
npm --prefix e2e/stage-a install
npm --prefix app install
```

`anvil` (Foundry 1.5) must be on `PATH`. Optional env: `FORK_URL` (default `https://rpc.monad.xyz`, read only by anvil), `FORK_BLOCK`.

## What it checks

1. **Deploy.** `forge script script/Deploy.s.sol` dry run against the fork, with `FOUNDRY_BROADCAST` pointed at a temp dir, so `contracts/broadcast/` is untouched. Then `contracts/script/monad-send.mjs check --fork` and `send --fork --confirm <fp>`. All six contracts get code. The wiring is verified, and every gas limit is the estimate + 10 %, rounded up to 1,000. The deployment goes to a temp `143-fork.json`, never `contracts/deployments/143.json`. A re-run sends nothing. `FX_OWNER` and `FX_SIM_TRANSMITTER` are the real deployer address, so the fork addresses are the ones the real launch will get from this source.
2. **`scripts/fund-lanes.mjs`.** The three relayer lanes are topped up to 1.3 MON from the deployer (RELAYER_2 already holds 0.2, so it gets 1.1).
3. **`scripts/fund-demo.mjs`.** Ben, Asha and Maya are topped up to $1.00 each from the treasury. A re-run sends nothing.
4. **`scripts/claim-links.mjs`.** Eight $0.50 links are created. The links go only to the private file, and none is printed. Each link is an open claim from the treasury whose signer is the link's key. Link 1 is then claimed with its key, as the app does. Writing links inside the repository is refused.
5. **`scripts/judges-plan.mjs`.** `check` simulates `createPot` and the two joins with `eth_simulateV1`. `send` creates "Metropolis Judges' Trip" with Maya, Ben and Asha as members, holding $1.00. The invite link has the app's format and is not printed.
6. **`scripts/return-funds.mjs`,** after the fork's clock moves past the links' expiry:
   - The 7 unclaimed links are refunded.
   - All AUSD ends at the treasury, except the $1.00 inside the judges' plan.
   - Every other account and the escrow hold $0.
   - MON is conserved exactly: before − gas paid = after.
   - Every MON holder is swept into the deployer, which gains exactly what was swept minus its own gas.
   - What stays behind is at most the sweep's `gasLimit × maxFee`.
   - MON moves only after a quiet window of k + 1 blocks.
   - A re-run finds nothing left to move.
7. **Refusals.**
   - `monad-send` and `return-funds` without `--fork` refuse the anvil RPC (it is not a Monad node).
   - `--fork` against a non-local RPC is refused.
   - A wrong fingerprint is refused.

## Safety

- **Keys.** Every key is a fresh throwaway key in a temp keys file with the same names as `../secrets/keys.env`. No real key signs anything, so no transaction valid on mainnet is ever created. The real `keys.env` is not read.
- **Network.** Transactions go only to the local anvil. The scripts refuse `--fork` unless the RPC is `127.0.0.1`/`localhost` and `web3_clientVersion` says anvil.
- **Gas.** Gas limits here are anvil's `eth_estimateGas`. That is acceptable only because this is a fork test. Without `--fork`, the scripts refuse any anvil, hardhat, ganache or tenderly RPC, and signing for chain 143 refuses a limit that did not come from a Monad RPC.
- **Block time.** anvil runs with 1-second blocks, so the k-block quiet window before MON sweeps (Monad's reserve-balance emptying rule) can elapse.
