# Metropolis submission: field text

This file holds the text for every field of the Metropolis submission form, in the form's order. Paste each block as is. The portal saves in place and has no final-submit button, so whatever is saved when submissions close (13 Oct, 23:59 ET) is the entry. Every block must be true of the product **as it stands** whenever it is pasted.

Rules for editing this file:
- Anything not live is marked **pending** in the field text. Flip a marker only when the thing works on the stated network.
- After any edit, run `python3 scripts/submission_counts.py`. It rewrites the character counts and fails if a field is over its limit. Counts are UTF-16 code units, which is how browsers count text fields.
- Never put claim links, invite secrets or keys in this file. The repository is public. Those go into the portal's private judge field only (marked below).
- Update this file in the same commit as any product change that makes a sentence here true or false.

Last updated: 8 Oct 2026. Product state: live on Monad testnet (contracts verified, relayer, web app at plans.0xo.in/app, Android test build, self-hosted indexer syncing, two Chainlink CRE rounds). Not on mainnet. Not yet run: the multi-device end-to-end run on testnet (Stage B) and the pilot. Portal: only the repository URL is saved so far.

How each claim below was checked on 8 Oct 2026:

| Claim | Check |
|---|---|
| Six contracts deployed and verified on testnet | `contracts/deployments/10143.json`; `curl https://sourcify-api-monad.blockvision.org/v2/contract/10143/<address>` returns `exact_match` for all six |
| Relayer live, web push on, Expo push off | `curl https://relayer-production-ecef.up.railway.app/v1/health`: `ok: true`, `chainId: 10143`, `push.web.enabled: true`, `push.enabled: false` |
| Relayer publishes the indexer URL | `curl …/v1/config`: `graphqlUrl` = the Railway Hasura URL |
| Indexer syncing, not caught up | `{ _meta { progressBlock sourceBlock isReady } }` on the public GraphQL: `isReady: false` on 8 Oct |
| Web app live on testnet | `https://plans.0xo.in/app` 200; `/app/build.json` → `network: testnet`, built 2026-10-07T22:14Z |
| Post-deploy check 43/43 | `e2e/web/.runs/postdeploy-20261007T221523Z-a80c7ab/results.json` (Chrome 28, Safari 14, HTTP 1) |
| First transaction from the web | `docs/first-tx-timing.md`, live 8 Oct: 8 taps, 6.05 s (1440 px), faucet tx `0x635c5408…` |
| CRE rounds 1 and 2 | `cast receipt` of `0x66ad55a2…` and `0x94f2071f…` (status 1, `RoundWritten` from FxReference); `cast call 0xaB7e…FCa2 'latestRoundTime()(uint64,uint64)'` → 2 |
| Test counts | contracts 250 (`forge test --list`), relayer 165, indexer 26, app 314, CRE workflow 69 (each suite run 8 Oct, except contracts: last full run 7 Oct) |

---

## Primary track

Consumer Products & Payments. Already selected and saved in the portal.

## Project details

### Project logo

**Pending.** You supply it. Requirements: PNG, JPG or WEBP; at least 500 px; up to 4 million pixels; 2 MB maximum.

### Project name

<!-- field: Project name | limit: 120 -->
Characters: 5 / 120
```text
Plans
```

### One-line description

<!-- field: One-line description | limit: 200 -->
Characters: 165 / 200
```text
A group money pot for trips and plans: friends in different countries join with one fingerprint, spend under rules the group sets, and settle up in one tap on Monad.
```

### Description

<!-- field: Description | limit: 8000 -->
Characters: 6163 / 8000
```text
Plans is a group money pot for trips, festivals and anything friends plan together, including friends who live in different countries. It runs as an Android app and as a web app in any browser, on Monad.

THE PROBLEM
A group plan runs on one person's card and a spreadsheet. One friend pays the villa deposit, another buys the festival tickets, and weeks later the group is still working out who owes whom, in three currencies. A shared bank account needs everyone to bank in the same country. A crypto wallet needs everyone to manage seed phrases and gas. Neither works for a group chat of friends.

WHAT PLANS DOES
Each item shows its status. "Testnet" means built, deployed and in the published test builds on Monad testnet (the web app at https://plans.0xo.in/app and the Plans Test Android app). "Pending" means not live yet. Nothing is on mainnet yet.

1. Join with one fingerprint (testnet). A passkey creates the account: no seed phrase, no password, no gas token. The same passkey restores everything on a new phone. In a browser, Plans first looks for an existing Plans passkey, so nobody gets a second account by accident.
2. Use it on a laptop too (testnet). Link a browser to the account you already have: the browser saves its own passkey, you check three pictures match, then confirm on your phone.
3. One shared pot in digital dollars (testnet, with Agora's testnet AUSD). Members add dollars from wherever they live and see the same balance in their own currency.
4. Rules the group sets, enforced by the pot contract (testnet): an instant-spend limit, approvals above it (one other member, or a majority), budgets per category, caps per person per day, who can be paid, a pause any member can press, timelocked rule changes and an end date. A spend that breaks a rule is rejected by the contract, not by our server.
5. Live activity (testnet). Spends, approvals and top-ups show up as they land. Browser notifications work through web push. Android push notifications: pending.
6. Paying people outside the group (testnet). Reimburse a member, pay anyone with a Plans code, or send a claim link: they open it, make a passkey and claim. Unclaimed links refund.
7. Send across borders (testnet). A Send tab moves dollars directly between people, with both currencies and the reference exchange rate on the receipt.
8. Disputes, early exit and refunds (testnet). Any member in a split can dispute a spend and the others vote. Exits and refunds follow fixed onchain formulas.
9. Settle up in one tap (testnet). After the end date any member taps Settle up. One transaction pays everyone what they are owed and collects from anyone who owes, through a capped allowance agreed when joining. No organiser, server or admin key is needed. If a payout can't be made at that moment, the money stays that member's, and anyone can later tap Collect to pay it to them and nobody else.

HOW IT WORKS
- Accounts: Mera (Category Labs) is the entire account layer. Each person's signing key comes from their passkey's WebAuthn PRF output, and toViemAccount signs every action. No custody backend, no other wallet SDK.
- Money: AUSD by Agora. Deposits and sends use AUSD's ERC-3009 signed transfers; every other action is an EIP-712 message to the pot. A relayer pays gas, so users never hold MON. Anyone can submit the signed messages; the relayer is a convenience, not a gatekeeper.
- Contracts: a factory that deploys one pot contract per plan, a key registry, a send router, a claim escrow and FxReference. No admin keys over funds. Unit, fuzz and invariant tests, including that members' balances always sum to the pot's balance.
- Privacy: a second passkey namespace (PRF salt "plans.keys.v1") gives each member an encryption key. Receipts, notes and names are encrypted to the group.
- Data: an Envio HyperIndex indexer derives balances, budgets, the who-owes-whom graph and cross-border volume by country pair. On testnet it is self-hosted on Railway and still syncing; Envio Cloud is configured and pending.
- Exchange rates: a Chainlink CRE workflow reads three public FX sources, takes the median and writes rate rounds to FxReference. Sends can cite a round (the contract records the reference rate and the difference), and settle-up tags the latest fresh round. Rounds are for receipts only and never price a transfer. Two rounds are on testnet, written with "cre workflow simulate --broadcast" (Chainlink's simulation forwarder); a deployed DON workflow is pending.

WHY MONAD (measured on mainnet, 5 Oct 2026, 20:18 to 20:28 UTC)
- Blocks every 301 ms (median) and finality at 583 ms (median; 650 ms at p95). A spend reaches every phone before the spender looks up.
- A relayed AUSD transfer was estimated at 112,910 gas, about $0.0004 at the time. At that cost the app can sponsor every tap, including approvals and votes.
- Each plan is its own contract with its own storage, so many groups settling at once don't contend for the same state under parallel execution.
- eth_sendRawTransactionSync returns the receipt in the same call, so the app shows "done" without polling.

STATUS (8 Oct 2026)
Done: six contracts with 250 tests (unit, fuzz, invariants, and fork tests against real AUSD on Monad mainnet); gas for 49 actions checked exactly against live Monad mainnet; the relayer (165 tests); the Envio indexer (26 tests); the app, Android and web from one codebase (314 tests); the Chainlink CRE workflow (69 tests). 256 end-to-end scenarios pass on a mainnet fork with real AUSD.
Live on Monad testnet: six contracts deployed and verified on MonadVision; the relayer, with browser push; the web app at https://plans.0xo.in/app, checked after every deploy in Chrome and Safari against the public URL (last run 43 of 43); the Plans Test Android build; the self-hosted indexer (syncing); two Chainlink CRE exchange-rate rounds.
Pending: Android push, Envio Cloud, a deployed CRE DON workflow, the multi-device end-to-end run on testnet, the pilot with real groups, mainnet deployment and live numbers on the stats page.
Live on mainnet: nothing yet. This description is updated as each part ships, with contract addresses and transaction hashes.
```

### Go-to-market and user acquisition strategy

<!-- field: Go-to-market and user acquisition strategy | limit: 8000 -->
Characters: 4527 / 8000
```text
FIRST USERS
Friend groups that already collect money in a group chat for a trip or a festival, with at least one member living in another country. For example: students and young professionals in the UK and US travelling with friends from home in India or Nigeria, or a mixed group going to a festival together. Each group has one organiser who brings 4 to 8 people, so every plan is its own small acquisition loop.

Plans has no card or bank on-ramp yet. So the first people who can fund a plan on day one are those who already hold digital dollars or have an exchange account: the Monad community, and crypto-native friends who organise trips for friends who are not. They are the beachhead. Their friends are the users who never see a blockchain.

CHANNEL
1. The invite link. Every plan is made to be shared in an existing group chat. The link opens the app, or the web app in the browser if Plans isn't installed. This is the core channel and costs nothing per user.
2. Organisers first. We recruit organisers directly: Monad community channels (Discord and X), international-student societies and university travel groups in the UK and US, and festival group chats. The ask is one plan, not one install.
3. The settle-up moment as content. Each settlement can produce a shareable summary ("6 friends, 3 countries, settled in one tap"). That post is what brings the next organiser.
4. Daily build posts on X (@PlansOnMonad), each with a short clip of the real product or real command output.

INSTALL TO FIRST FUNDED ACTION
1. Tap the invite link in the group chat.
2. Use Plans straight away in the browser (no install), or install the Android app: an APK from our site during the hackathon, the Play Store after.
3. One fingerprint: account created.
4. First funded action: add money to the plan, or claim a link a friend sent. The organiser can send each member a claim link for their share, so a member with no dollars yet still completes a funded action with one more tap.
Measured on the live web app on Monad testnet (8 Oct 2026, scripted run with a virtual passkey): from the landing page to a confirmed first transaction (free test dollars) takes 8 taps and about 6 seconds on a laptop, 7 on a phone-sized browser. A person adds reading time and the passkey gesture. The Android path is measured by hand on a phone (pending).
The two known friction points are the sideloaded APK (the web app removes it) and getting dollars without an on-ramp. The business path below addresses the second.

MEASURED SO FAR
Nothing is on mainnet yet, so every mainnet number is zero. We report only numbers we can read onchain. From the first mainnet deployment, the public stats page (live numbers pending) and docs/traction.md in the repository will report these, straight from our Envio indexer:
- users: people who joined a real plan or sent money to someone
- plans created, and plans with at least one contribution
- members per plan, and countries per plan
- median time from joining a plan to its first funded action
- spends, approvals, settlements and settled volume
- cross-border volume by country pair
- APK downloads, from the GitHub release counter (offchain, labelled as such)
Demo accounts, plans that include them, and our own test accounts are excluded from every number.

PILOT BEFORE JUDGING (targets, not results; pending)
Before 13 Oct: three real groups, at least 12 people across at least 3 countries, each running a small real plan from invite to settlement. Results will be reported here and on the stats page as they happen.

PATH TO A BUSINESS
- Free for groups. Plans does not charge to create, join, spend or settle. Sponsoring every action of a six-person trip costs about three cents at the Monad fees we measured.
- Float income. Money sits in a pot for the length of a plan. AUSD is fully backed by short-term US Treasuries, overnight repo and cash, and Agora states that it shares the economics with partners who build with AUSD. A partnership would turn pot balances into revenue without charging users.
- Money in and out. Card and bank on-ramp and off-ramp through a licensed partner in each corridor, with a disclosed FX margin. This is also the fix for the biggest funnel friction.
- Organisers. Festival promoters, travel organisers and student societies running many plans get a paid tier: branded plans, bulk invites and exports for their accounts.
- After the hackathon: Play Store release, one on-ramp partner for the UK and US, then iOS (the web app already works on iPhone browsers).
```

### GitHub repository

<!-- field: GitHub repository | limit: 2000 -->
Characters: 36 / 2000
```text
https://github.com/Baskarayelu/plans
```

## Demo and pitch

### Live product

The portal requires an https link that runs on Monad mainnet or testnet. The web app runs on Monad testnet now, so this field can be filled. Switch it to the mainnet build when that exists.

<!-- field: Live product | limit: 2000 -->
Characters: 24 / 2000
```text
https://plans.0xo.in/app
```

### Technical demo video

**Pending.** Up to 3 minutes; the working product only, no slides or code walkthrough. Shot list: [storyboards.md §2](storyboards.md#2-technical-demo-required-at-most-300).

### Pitch video

**Pending.** Up to 2 minutes, generated voice, no one on camera. Shot list: [storyboards.md §3](storyboards.md#3-pitch-video-required-at-most-200).

### Judge access instructions (optional, private to judges)

Mainnet funds and claim links are pasted into the portal only. The bracketed slots below mark where they go.

<!-- field: Judge access instructions | limit: 8000 -->
Characters: 5033 / 8000
```text
STATUS (8 Oct 2026): Plans is live on Monad testnet, with free test dollars. Mainnet is pending. Part A works today. Part B is the mainnet path; each step stays marked pending until it works, and this field is updated as steps go live.

PART A: MONAD TESTNET, IN YOUR BROWSER (about 5 minutes)
You need a laptop or phone with Chrome or Safari and a screen lock (fingerprint, face or PIN). No wallet, no MON, no install.
1. Open https://plans.0xo.in/app and tap Create account. Plans first looks for an existing Plans passkey in this browser. When it finds none, tap "I'm new to Plans" and confirm with your fingerprint, face or screen lock. Enter a name and pick your country.
2. Get test dollars: Add money, then Get test dollars, then "Get $25 test dollars". The balance updates when the transaction is confirmed on Monad testnet. One top-up a day per account; if the network is busy, the screen says so.
3. Try a settle-up: on Home tap "Start demo", then "Start the demo". You join a small plan with three demo members (Ben in London, Asha in Bengaluru, Maya in New York), labelled Demo and run by our relayer. Your join is a real testnet transaction. Then follow the steps on screen: a $0.40 spend that a demo member approves, then "End plan & settle up". (Pending: we have confirmed the join on testnet; the rest of the demo is being re-run on testnet and this line will say so when it is confirmed.)
4. Optional: You > Notifications > Turn on notifications (on iPhone, add Plans to the Home Screen first; the screen shows how). Then You > Devices with your passkey, to link another browser to the same account.
5. Tap Proof on any receipt to see the transaction on a Monad testnet explorer.
An Android test build (Plans Test) is at https://plans.0xo.in/download, with its SHA-256 on the page.

PART B: MONAD MAINNET (pending)
- Plans contracts on Monad mainnet (chain 143): pending, not deployed yet. Addresses and sample transactions will be listed here and in the repository README.
- Money is AUSD at 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a, Agora's official Monad deployment.
- Demo funds on mainnet are deliberately small: judge claim links of $0.50 each and a judges' plan holding $2 (pending).
- Gas is paid by our relayer. You never need MON.

WHAT YOU NEED FOR PART B
- An Android phone, Android 9 or newer, signed in to a Google account, with a screen lock; or any browser from Part A. Plans saves your passkey in Google Password Manager on Android. If the phone asks where to save the passkey, choose Google Password Manager: some other password managers do not support the passkey feature Plans needs.
- About 10 minutes.

1. INSTALL (pending for mainnet)
Open https://plans.0xo.in on the phone and download the Plans APK (its SHA-256 is shown on the page). When Android asks, allow your browser to install unknown apps, then tap Install. If Google Play Protect says the developer is unrecognised, tap More details, then Install anyway.

2. CREATE YOUR ACCOUNT (pending for mainnet)
Open Plans, tap Create account and confirm with your screen lock. Enter a name and pick your country.

3. GET DEMO DOLLARS (pending)
Open one of the claim links below. Each holds $0.50 in AUSD on mainnet and can be claimed once. Tap Claim. If a link is already used, take the next one. Unclaimed links return to the sender after 31 Oct.
[Claim links: added in the portal only, at release.]

4. JOIN THE JUDGES' PLAN (pending)
Open [judges' plan invite link: portal only, at release] and tap Join. On this plan, spends up to $0.25 go through instantly and larger spends need one other member's approval.

5. CORE FLOW (pending)
a. Add $0.25 to the plan with Add money.
b. Pay $0.10 from the pot to Asha (Bengaluru), category Food & drink, split with everyone. It goes through instantly.
c. Try a $0.40 spend. The app shows "Needs 1 more approval". The demo member Ben (London) approves and the spend goes through. Ben, Asha and Maya are demo accounts run by our relayer, labelled Demo, and never counted in our user numbers.
d. Open Send, pick Asha and send $0.05. The receipt shows both currencies and the reference rate.
e. Try a settle-up, as in Part A step 3, then tap Proof on any receipt.

6. FRESH-DEVICE TEST (pending verification on a physical phone)
Android Settings > Apps > Plans > Storage > Clear storage. Open Plans, tap "I already use Plans" and confirm with your screen lock. Your account, plans, balances and encrypted receipts come back, rebuilt from your passkey. The key fingerprint (three emoji under You) matches the one before.

IF SOMETHING FAILS
- "This browser can't save a passkey": use Chrome or Safari, or the Android app.
- "Passkey not supported" on Android: make Google Password Manager your passkey provider (Settings > Passwords and accounts), then retry.
- A link opens in the browser instead of the app: that's fine, the web app works too; or paste the link into Plans > Join with a link or code.
- No test login is needed or possible: Plans accounts are passkeys you create on your own device.
```

## Bounties

Bounty answers are text areas with an 8,000-character limit; bounty video links are URL fields with a 2,000-character limit (confirmed by the entrant, 6 Oct).

### Recommended selection (8 Oct 2026)

| Bounty | Add? | Why |
|---|---|---|
| Agora: Best Cross-Border Payments App on Monad | **Add now** | Track 02 only, which is our track. Send and cross-border settle-up are core flows. |
| Monad Foundation: Best Mera-Powered UX on Monad | **Add now** | Mera is the only account layer. |
| Monad Foundation: Mera: One Passkey, Many Keys | **Add now** | The `plans.keys.v1` namespace does the encryption work. |
| Envio: Best Use of Envio | **Add now** | Balances, the settlement graph and corridor stats come from HyperIndex. Self-hosted indexer live on testnet; Envio Cloud pending. |
| Chainlink: Best workflow with CRE | **Add now** | The card accepts "build, simulate, or deploy". Two simulated rounds are onchain on Monad testnet; DON deployment pending. |
| Aurora Intents: Bring Any-Chain Liquidity to Monad | **Do not add yet** | Every Monad route was unavailable when re-tested on 5 Oct, 20:59 UTC, and Aurora lists no AUSD. Re-test on 10 Oct. |

### Agora: Best Cross-Border Payments App on Monad

**Asked at submission:** "Describe the core features of your app with a focus on how it enables a user to send AUSD to another person or across borders"

<!-- field: Agora: core features answer | limit: 8000 -->
Characters: 2371 / 8000
```text
Plans is a group money pot and a send app on Monad in which AUSD is the only money. It runs as an Android app and as a web app. Status (8 Oct 2026): every feature below is built and live on Monad testnet with Agora's testnet AUSD (0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC), in the web app at https://plans.0xo.in/app and the Plans Test Android build. Mainnet with AUSD 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a: pending.

Sending AUSD to another person or across borders:
1. Onboarding with one Mera passkey prompt. No seed phrase, password or gas token. A synced passkey restores the account on any phone, and a laptop browser can be linked to the same account.
2. Send tab. Scan a friend's Plans code (or upload a photo of it in a browser), or pick someone recent, type an amount in your own currency, and confirm with your fingerprint. The receiver sees it in their currency. The receipt shows both currencies, the reference exchange rate and its time, the fee ($0.00), "Settled in" with the measured time, and a Proof link to the Monad transaction.
3. Gasless. The sender signs an AUSD ERC-3009 authorisation and our relayer submits it, so neither side holds MON. On mainnet a relayed AUSD transfer was estimated at 112,910 gas, about $0.0004.
4. Send by link. Send AUSD to someone who has no account yet, in any country. They open the link, create a passkey with one prompt and claim. Unclaimed money returns to the sender.
5. Group money across borders. Members in different countries fund one AUSD pot, spend from it under rules the group sets, and settle in one transaction that pays everyone, in London, New York and Bengaluru, at once. If one payout can't be made at that moment (for example, an account is frozen), the money stays theirs and anyone can later trigger Collect, which pays only that member.
6. Exchange-rate transparency. A Chainlink CRE workflow writes reference-rate rounds to our FxReference contract. A send can cite a round, and the PlansSend contract then records the reference rate and the difference from the shown rate in the onchain receipt. Two rounds are on testnet (simulation forwarder); a deployed DON workflow is pending. Today the app's rate line comes from ECB reference rates signed by our relayer.

Monad finality was measured at 583 ms median on mainnet (5 Oct 2026). Pending: the required demo video, recorded on mainnet.
```

**Demo video (required, up to 2 minutes): pending.** Shot list in [storyboards.md §1](storyboards.md#1-agora-bounty-video-required-at-most-200). The app must provide this exact path on mainnet, uninterrupted, between two members in different countries:

1. **Phone B ("Sam, New York"), fresh install:** Create account, one fingerprint, country United States. Home shows $0.00. *(passkey onboarding)*
2. **Phone A ("Leah, London"), funded beforehand by claim link:** open the Send tab. It shows "You can send" with the AUSD pill. *(AUSD balance)*
3. **Phone B:** My Plans code.
4. **Phone A:** Scan code, scan Sam's code, enter £1.00. The app shows "Sam gets $1.3x". Continue, confirm with fingerprint.
5. **Phone B** receives it: the received screen shows "+$1.3x" from Leah, London. The receipt shows both currencies, the reference rate, "Settled in 0.x s" and a Proof link to the mainnet transaction. *(completed send and receive, settled instantly)*
6. **Optional:** Sam taps Send back with $0.50 and Leah's phone receives it.

Funding: Leah's account is funded with a $3.00 claim link from the Plans treasury, so its address doesn't need to be known in advance. Leah and Sam are team test accounts, listed in `indexer/internal-accounts.json` and excluded from every number.

### Monad Foundation: Best Mera-Powered UX on Monad

**Asked at submission:** "Describe how your project meaningfully integrates Mera as the entire account layer"

<!-- field: Mera UX: account layer answer | limit: 8000 -->
Characters: 2109 / 8000
```text
Mera (@category-labs/mera 0.2.0) is the only account layer in Plans: no Privy, no Dynamic, no injected wallet, no custody backend. Status (8 Oct 2026): built and live on Monad testnet, in the Android test build and the web app at https://plans.0xo.in/app. Mainnet: pending.

- Create: a discoverable passkey with the PRF extension (Android Credential Manager in the app; WebAuthn in the browser). Its PRF output, under Mera's default salt, derives the user's key via Mera's documented recipe. Checked on 7 Oct: Android 15 (Google Password Manager), Mac Chrome, Mac Safari, iPhone Chrome and iPhone Safari all returned the PRF output from one prompt, the same at create and sign-in.
- Restore: "I already use Plans" asks for the passkey with no stored credential and returns the same PRF output, so the same account, plans and receipts come back on a new phone or after app data is cleared. Nothing is kept on our servers. In a browser, Create account first looks for an existing Plans passkey, so a user never gets a second account by accident. The clear-storage test on a physical phone: pending.
- Signing sessions: one fingerprint opens a Mera secp256k1 signing session, and toViemAccount signs every EIP-712 action and AUSD ERC-3009 authorisation without further prompts: spends, approvals, votes, sends and settle-up. The session key lives in memory only.
- Several devices, one account: a laptop browser can be linked. It saves its own passkey; the person compares three pictures on both screens and approves on the phone with a fingerprint. The browser gets a sealed copy of the account that only its own passkey opens, and the phone can remove it later.
- First transaction: on the live web app, from the landing page to a confirmed testnet transaction takes 8 taps and about 6 seconds (scripted run, 8 Oct), with one passkey prompt.
- Gas never appears: signed messages go to our relayer, and users never hold MON.
- The UI never says wallet, address, gas or transaction: a build check fails on those words. Users see "Confirm with fingerprint", "Settled in" with the measured time, and a Proof link.
```

**Optional video (up to 2 minutes): the join flow plus the stateless test.** Fresh install, open an invite link, "Join with fingerprint" (one prompt), then approve and spend with no further prompts. Then Android Settings > Clear storage, reopen, "I already use Plans", one prompt, and everything is back. Pending.

### Monad Foundation: Mera: One Passkey, Many Keys

**Asked at submission:** "Describe how your project meaningfully utilizes Mera in non-account work."

<!-- field: Mera Many Keys: non-account work answer | limit: 8000 -->
Characters: 2008 / 8000
```text
Namespace: plans.keys.v1, a PRF salt of SHA-256("plans.keys.v1"), separate from the default salt that derives the account key. It never signs a transaction. Status (8 Oct 2026): built and live on Monad testnet in the Android test build and the web app. Mainnet: pending.

What it does:
1. Group encryption identity. HKDF over the plans.keys.v1 output gives each member an X25519 key pair. The public key is registered when they join. Each plan has a random group key, sealed to every member's X25519 key. Receipt photos, spend notes and member names are encrypted with the group key, so only the group can read them; the chain and our servers see ciphertext only.
2. Local cache key. A second HKDF branch encrypts the app's on-device cache, so a copied backup reveals nothing.
3. Cross-device proof. The same passkey on a second device re-derives the same X25519 key. The app shows its fingerprint as three emoji (You > Your key), identical on both devices, and old receipts decrypt there with nothing transferred.
4. A vault for a linked browser. When a laptop browser is linked to an account, it makes its own passkey, and that passkey's plans.keys.v1 output derives (by HKDF) the key that seals the browser's copy of the account and the token that authorises reading it. The vault on our relayer is ciphertext that only that browser's passkey can open. The phone can remove the browser later, and its open tab then locks itself.

How it is evaluated: a Mera WebAuthn client wrapper asks the authenticator for both salts in one ceremony (the WebAuthn PRF "first" and "second" inputs), so joining a plan stays at one fingerprint. Checked on 7 Oct: both outputs came back from one prompt on Android 15 (Google Password Manager), Mac Chrome, Mac Safari, iPhone Chrome and iPhone Safari. If a provider returns only one output, the app asks for a second fingerprint the first time encrypted content is opened on that device. Encryption uses @noble X25519 and XChaCha20-Poly1305, because Hermes has no WebCrypto.
```

**Optional video (up to 2 minutes): the cross-device key test.** Phone 1 shows the plan's encrypted receipt and the key fingerprint emoji. Phone 2 signs in with the same passkey (one prompt), shows the same fingerprint and opens the same receipt. Pending.

### Envio: Best Use of Envio

**Asked at submission:** "Describe how your project meaningfully uses Envio's HyperIndex, HyperSync or HyperRPC to power real on-chain data in your app — not just installed, but actually driving a feature."

<!-- field: Envio: usage answer | limit: 8000 -->
Characters: 2114 / 8000
```text
An Envio HyperIndex indexer (envio 3.12.1) is the app's data layer for everything except the instant live feed. The app has no database of its own.

Deployment status (8 Oct 2026):
- Live: the indexer is self-hosted on Railway (Postgres, Hasura and the HyperIndex indexer, from indexer/Dockerfile) and indexes Monad testnet from block 68,940,999 over Monad's public RPC. Public GraphQL: https://hasura-production-c5c7.up.railway.app/v1/graphql. Our relayer publishes that URL at /v1/config and the app reads it from there. On 8 Oct it was still catching up with the chain.
- Configured, pending: Envio Cloud with HyperSync (indexer/config.yaml). It goes live once two old deployments are cleared from the project's slots; switching is one URL on the relayer and one on the site.
- Mainnet: pending.

Schema: 34 entities, linked with @derivedFrom. Handlers maintain derived and aggregated entities:
- MemberBalance: each member's live net position in a plan. It drives each member's balance on every plan screen.
- CategorySpend: spend against each category budget. It drives the budget bars and the warning before a spend would break a budget.
- SettlementEdge: the minimal who-owes-whom graph, recomputed on every ledger change (deterministic greedy min-cash-flow, tested on 2,000 random pots). It drives the Settle up preview, before any money moves.
- Corridor: AUSD volume and count by country pair. It drives the public stats page.
- PotDaily, DailyStats, GlobalStats: time series and totals, with demo and team accounts excluded.
- Payout and Collected: who was paid at settle-up, and who collected later.
- FxRound and Send: each send's applied rate against the Chainlink CRE reference round.

The app queries GraphQL for plan lists, history, balances and the settle-up preview. A fresh-device restore rebuilds a user's plans from the indexer by their address, because Monad's public RPC limits log queries to 100 blocks. Monad websocket logs give the instant updates; the indexer gives the history and every derived number. 26 tests, including the invariant that members' balances sum to the pot's balance.
```

**Optional video (up to 2 minutes): spend to settle-up preview.** Make a spend in the app. A split screen shows the GraphQL endpoint with the new Spend, then the updated MemberBalance and SettlementEdge entities. Back in the app, the settle-up preview updates. Pending (needs the indexer caught up).

### Chainlink: Best workflow with CRE

**Bounty card (2nd: another entrant's copy of the card; the official detail page has not been read):** "Build, simulate, or deploy a Chainlink Runtime Environment (CRE) Workflow used as an orchestration layer within your project." The portal's question for this bounty has not been captured yet; the answer below is written to fit a "describe your integration" field. Paste the official question here when the portal shows it.

<!-- field: Chainlink CRE: usage answer | limit: 8000 -->
Characters: 3726 / 8000
```text
Plans uses a Chainlink CRE workflow, written with the TypeScript SDK, to put reference exchange rates on Monad. Code: https://github.com/Baskarayelu/plans/tree/main/cre/fx-workflow

Status (8 Oct 2026), stated precisely: the workflow has run as a CRE simulation with --broadcast ("cre workflow simulate fx-rates --broadcast", CLI v1.37.0). Each run made a real transaction on Monad testnet through Chainlink's MockKeystoneForwarder (0xB9F79d863261869B234c481D1f9A7af84AeAd192), which delivered the report to our FxReference contract (0xaB7eeDe1DA994137a340155f350A8F81358FFCa2, verified on MonadVision). It is not yet deployed to a CRE DON: that needs workflow-deployment access, which we have not requested yet. Pending.
- Round 1: 0x66ad55a247afa377891003740866303791aaa41edfcff9c161e35015de16f8a6 (block 69,031,314)
- Round 2: 0x94f2071fe1d1b2afc4e999552d106f5dd5158d64355cd13bfac10c445920c1b3 (block 69,031,576)
Both succeeded and each emitted RoundWritten. latestRoundTime() on FxReference returns round 2, with rates for 8 currencies.

What one run does:
1. Cron trigger, every 30 minutes. The scheduled time comes from the trigger, capped at DON time; the host clock is never read.
2. In node mode, each node fetches up to three public FX sources (Frankfurter with ECB rates, Frankfurter's central-bank blend for AED and NGN, and the fawazahmed0 currency API with a fallback mirror). For each of GBP, EUR, INR, NGN, JPY, CHF, AED and SGD it converts to USD per unit with 8 decimals in exact integer maths, drops any source more than 2% from the median, and keeps a rate only if at least 2 sources agree.
3. Consensus across nodes: median for each rate, identical agreement for each source mask and the rate date.
4. Guards against the contract's state: it reads FxReference's last rates and limits, skips a replayed schedule, and leaves out any currency that moved more than the contract allows, so one bad source cannot get a whole round rejected.
5. It ABI-encodes the report exactly as FxReference decodes it, signs it with runtime.report and calls writeReport with a gas limit taken from Monad's own estimator, then checks both the transaction status and the receiver's execution status.

How Plans uses the rounds (the orchestration role): FxReference stores numbered rounds. PlansSend lets a send cite a round: the contract checks the round is known and under 6 hours old, and records the reference rate and the difference between the rate the sender saw and the reference in the onchain receipt. Pot settle-up tags the settlement with the latest fresh round. The relayer serves the latest round at /v1/fx/round, and the Envio indexer stores rounds and links them to sends and settlements. Rates are for receipts only: they never price a transfer and FxReference never holds or moves funds.

Security: in simulation mode FxReference accepts a report only from the mock forwarder and only when the transaction comes from our transmitter key, because the mock forwarder checks no DON signatures. That is a demo guard, not oracle security, and the contract says so. Production mode (one owner call) accepts only the KeystoneForwarder with our workflow id and owner. Every report also carries the chain selector (replay across chains) and a strictly increasing scheduled time (replay on the same chain).

Not done yet: the DON deployment, rounds on a schedule (today the simulation is run by hand before settle-ups, so rounds go stale after 6 hours and sends then cite no round), and the app's own rate line reading the round (today it shows ECB rates signed by our relayer). Tests: 69 offline tests for the workflow (parsing, maths, median, encoding, guards, a golden report vector), plus FxReference contract tests.
```

**Optional video:** none required by the card text we have. If one is added: the terminal clip `marketing/clips/day-13-cre-rounds-testnet.mp4` (real `cast` reads of both rounds) plus a fresh `cre workflow simulate --broadcast` run.

### Aurora Intents: Bring Any-Chain Liquidity to Monad (not recommended yet)

**Asked at submission:** "Describe how your project integrates at least one Aurora Intents product"

Not drafted as a claim. Evidence in `research/evidence/aurora/` (outside this repo):
- 1Click quotes for every Monad pair returned "Quoting for this pair is not available" (re-tested 5 Oct, 20:59 UTC).
- Aurora's incident feed lists `chain monad` as active since 3 Oct, 16:20 UTC.
- Aurora's token list has no AUSD on any chain.

The bounty's video must show "funds arriving from another chain and being used within the app". If routes return by 10 Oct, the flow would be "Add from another chain": USDC on Base arrives as USDC on Monad, is swapped to AUSD, then funds a plan.

**Optional video:** that flow, only if it works live.

## Optional promotion

| Field | Status |
|---|---|
| Product advertisement (up to 30 s) | **Pending.** Cut from the technical demo after it is recorded. |
| X profile link for the project | https://x.com/PlansOnMonad (36 characters, URL field limit 2,000) |
