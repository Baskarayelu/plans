# Funding

Every amount below is the smallest that makes each flow run and read well on screen. Gas comes from [contracts/GAS.md](../contracts/GAS.md): suggested gas limits, measured against live Monad mainnet on 6 Oct 2026. Monad charges the gas limit, not the gas used. Price assumed: 102 gwei (100 gwei base fee floor plus a 2 gwei tip).

**Send to two addresses only.** I spread the funds from there: MON to the relayer keys, AUSD to the claim links and demo accounts.

```
Deployer (MON, mainnet and testnet):  0x44E61d9E73394EDEBAB7095D224B0a6185EDa4e3
Treasury (AUSD, mainnet):             0x0C2118133d7dFC751c326c86a5ddff5cF3846E35
```

## Stages

Funding comes in stages. Plan only around the stage that has arrived.

| Stage | When | Network | Token | Amount | To | For | Spent or recoverable |
|---|---|---|---|---|---|---|---|
| 1 | Now | Testnet | MON | 5 | Deployer | Testnet deploy (~1.0 MON) and all automated emulator runs | Test funds |
| 1 | Now | Mainnet | MON | 15 | Deployer | Mainnet deploy (~1.0 MON); the rest goes to the 3 relayer keys | Spent as fees; leftover recoverable |
| 1 | Now | Mainnet | AUSD | 8.00 | Treasury | $3 Agora video account, $3 demo members, $2 mainnet test runs | All recoverable |
| 2 | Mainnet release of the app | Mainnet | AUSD | 4.00 | Treasury | 8 judge claim links × $0.50 | Unclaimed links refund automatically |
| 3 | You confirm pilot groups | Mainnet | AUSD | $0.50 × confirmed pilot users | Treasury | One claim link per pilot user | Claimed money is the pilot user's |

**Rules while working:**
- Emulator test runs use **testnet** wherever the flow allows.
- Mainnet test spending stays inside the $2.00 test allowance.
- Recoverable money (the Agora video accounts, demo members, test accounts) goes back to the treasury when each flow is done, and every report states the treasury balance.

### MON on mainnet: 15 MON (about $0.47 at $0.0315)

| Use | Gas | MON |
|---|---|---|
| Deploy KeyRegistry, PlansFactory (with ClaimEscrow and Pot), PlansSend | 9.92 M | 1.01 |
| Judges: 8 × (claim, join, add money, instant spend, approval spend, demo vote, send, one "Try a settle-up" run) | ~35 M | 3.55 |
| Judge claim links, judges' plan and demo members joining | ~3 M | 0.30 |
| Pilot: 15 people × (claim, join, add money, 2 spends, a vote, a send, ack) plus 3 plans and settle-ups | ~32 M | 3.25 |
| Agora video: 5 takes × (claim, onboarding, send, send back) | ~4 M | 0.41 |
| Mainnet checks of flows that can't run on testnet | ~15 M | 1.53 |
| **Subtotal** | ~99 M | **10.05** |
| Buffer for retries and failed attempts (~50%) | | 4.95 |
| **Total** | | **15** |

After deployment, 14 MON covers about **680 average actions** of 200k gas each. Join with a deposit uses 428k gas; an approval vote uses 197k.

Reserve-balance note: Monad caps how much MON one sender can spend on gas within any three blocks. Splitting the MON across three relayer keys stays well inside that cap.

### Stage 1 AUSD on mainnet: $8.00

| Item | Amount | Notes |
|---|---|---|
| Agora bounty video: one $3.00 claim link for "Leah, London" | $3.00 | Shows a $3.00 balance, sends £1.00 (~$1.35) to Sam, Sam sends $0.50 back. Retakes reuse the same money. Returned to the treasury afterwards. |
| Demo members Ben, Asha, Maya: $1.00 each | $3.00 | Fund the judges' plan ($1.00 in total) and "Try a settle-up" runs (at most $0.30 per run, mostly paid back to the demo accounts at settle-up). |
| Mainnet test runs | $2.00 | Only for checks that can't run on testnet. Returned afterwards. |

## Cheapest way to get each token onto Monad mainnet

1. **Ramp Network (fewest steps).** Ramp sells MON and AUSD on Monad by card, bank transfer, Apple Pay or Google Pay, according to its announcement of 3 June 2026 (https://rampnetwork.com/blog/monad-live-on-ramp-network). Buy 15 MON with the deployer address as recipient, and $27 of AUSD with the treasury address as recipient. That is one purchase per token, delivered straight to the address. Ramp's minimum purchase amount isn't stated there. If it's above these amounts, buy the minimum and send it all to the same address.
2. **Fallback for MON: Kraken.** Kraken lists MON and supports withdrawals on the Monad network. Buy MON and withdraw on the **Monad** network to the deployer address.
3. **Fallback for AUSD: swap on Monad.** Get USDC on Monad, from an exchange that withdraws USDC on Monad or by bridging. Swap USDC → AUSD on the Uniswap v3 or PancakeSwap v3 AUSD/USDC pool, then send it to the treasury. This takes more steps and needs a wallet; use it only if Ramp doesn't work.
4. **Testnet MON:** use the Monad testnet faucet, or send from any wallet holding testnet MON, to the deployer address. Testnet AUSD needs nothing from you: the relayer draws it from Agora's testnet faucet.

None of these keys belong to any other project. The keys live only on this machine (`monad/secrets/`, outside the repository).

## Received and spent (ledger)

| Date | Network | In / out | Amount | From → to | Transaction | Note |
|---|---|---|---|---|---|---|
| 7 Oct 2026 | Testnet | In | 5 MON | → Deployer | (sent by Baskar) | Deployer 0.337 → 5.337 MON |
| 7 Oct 2026 | Testnet | Out | 1.30 MON | Deployer → relayer lane 1 `0x8A2b…8E78` | `0xe5b30c7d…c4ac` | gas limit 21000 from eth_estimateGas |
| 7 Oct 2026 | Testnet | Out | 1.20 MON | Deployer → relayer lane 2 `0x03Aa…A649` | `0x778c9e74…a172` | gas limit 21000 from eth_estimateGas |
| 7 Oct 2026 | Testnet | Out | 1.35 MON | Deployer → relayer lane 3 `0xe5ce…2662` | `0x956baa98…92e0` | gas limit 21000 from eth_estimateGas |
| 7 Oct 2026 | Testnet | Out | ~0.054 MON | Deployer → MockKeystoneForwarder | `0x66ad55a2…f8a6`, `0x94f2071f…c1b3` | Chainlink CRE FX rounds 1 and 2 (263,000 gas each) |

Balances after: deployer 1.43 MON, lanes 1.31 / 1.32 / 1.35 MON (testnet).
