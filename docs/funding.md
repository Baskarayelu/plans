# Funding

Every amount below is the smallest that makes each flow run and read well on screen. Gas comes from [contracts/GAS.md](../contracts/GAS.md): suggested gas limits, measured against live Monad mainnet on 6 Oct 2026. Monad charges the gas limit, not the gas used. Price assumed: 102 gwei (100 gwei base fee floor plus a 2 gwei tip).

**Send to two addresses only.** I spread the funds from there: MON to the relayer keys, AUSD to the claim links and demo accounts.

```
Deployer (MON, mainnet and testnet):  0x44E61d9E73394EDEBAB7095D224B0a6185EDa4e3
Treasury (AUSD, mainnet):             0x0C2118133d7dFC751c326c86a5ddff5cF3846E35
```

## What to send

| # | Network | Token | Amount | To | What it's for | Spent or recoverable |
|---|---|---|---|---|---|---|
| 1 | Monad **testnet** | MON | **5** | Deployer | Testnet deploy (~1.0 MON) and automated emulator runs | Test funds |
| 2 | Monad **mainnet** | MON | **15** | Deployer | Mainnet deploy (~1.0 MON); the rest goes to the 3 relayer keys for every user action | Spent as fees; anything left is recoverable |
| 3 | Monad **mainnet** | AUSD | **27.00** | Treasury | See breakdown below | Mostly spent; parts recoverable |

### MON on mainnet: 15 MON (about $0.47 at $0.0315)

| Use | Gas | MON |
|---|---|---|
| Deploy KeyRegistry, PlansFactory (with ClaimEscrow and Pot), PlansSend | 9.92 M | 1.01 |
| Judges: 8 × (claim, join, add money, instant spend, approval spend, demo vote, send, one "Try a settle-up" run) | ~35 M | 3.55 |
| Judge claim links, judges' plan and demo members joining | ~3 M | 0.30 |
| Pilot: 15 people × (claim, join, add money, 2 spends, a vote, a send, ack) plus 3 plans and settle-ups | ~32 M | 3.25 |
| Agora video: 5 takes × (claim, onboarding, send, send back) | ~4 M | 0.41 |
| Mainnet emulator runs: 3 full automated runs | ~15 M | 1.53 |
| **Subtotal** | ~99 M | **10.05** |
| Buffer for retries and failed attempts (~50%) | | 4.95 |
| **Total** | | **15** |

After deployment, 14 MON covers about **680 average actions** of 200k gas each. Join with a deposit uses 428k gas; an approval vote uses 197k.

Reserve-balance note: Monad caps how much MON one sender can spend on gas within any three blocks. Splitting the MON across three relayer keys stays well inside that cap.

### AUSD on mainnet: $27.00

| Item | Amount | Notes | Spent or recoverable |
|---|---|---|---|
| Agora bounty video: one $3.00 claim link for "Leah, London" | $3.00 | Shows a $3.00 balance, sends £1.00 (~$1.35) to Sam, Sam sends $0.50 back. Retakes reuse the same money between our two test accounts. | Recoverable (both are our accounts) |
| Judge claim links: 8 × $0.50 | $4.00 | Single use, expire 31 Oct | Unclaimed links refund automatically; claimed ones are spent |
| Demo members Ben, Asha, Maya: $1.00 each | $3.00 | Fund the judges' plan ($1.00 in total) and "Try a settle-up" runs (at most $0.30 per run, mostly paid back to the demo accounts at settle-up) | Mostly recoverable (we hold the keys) |
| Pilot claim links: 15 × $1.00 | $15.00 | One per pilot person, with a few spare | Claimed ones are spent (the money is the pilot user's); unclaimed refund after 7 days |
| Mainnet emulator test runs | $2.00 | Claim links for test accounts | Recoverable |
| **Total** | **$27.00** | | |

## Cheapest way to get each token onto Monad mainnet

1. **Ramp Network (fewest steps).** Ramp sells MON and AUSD on Monad by card, bank transfer, Apple Pay or Google Pay, according to its announcement of 3 June 2026 (https://rampnetwork.com/blog/monad-live-on-ramp-network). Buy 15 MON with the deployer address as recipient, and $27 of AUSD with the treasury address as recipient. That is one purchase per token, delivered straight to the address. Ramp's minimum purchase amount isn't stated there. If it's above these amounts, buy the minimum and send it all to the same address.
2. **Fallback for MON: Kraken.** Kraken lists MON and supports withdrawals on the Monad network. Buy MON and withdraw on the **Monad** network to the deployer address.
3. **Fallback for AUSD: swap on Monad.** Get USDC on Monad, from an exchange that withdraws USDC on Monad or by bridging. Swap USDC → AUSD on the Uniswap v3 or PancakeSwap v3 AUSD/USDC pool, then send it to the treasury. This takes more steps and needs a wallet; use it only if Ramp doesn't work.
4. **Testnet MON:** use the Monad testnet faucet, or send from any wallet holding testnet MON, to the deployer address. Testnet AUSD needs nothing from you: the relayer draws it from Agora's testnet faucet.

None of these keys belong to any other project. The keys live only on this machine (`monad/secrets/`, outside the repository).
