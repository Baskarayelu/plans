# Metropolis submission: field text

This file holds the text for every field of the Metropolis submission form, in the form's order. Paste each block as is. The portal saves in place and has no final-submit button, so whatever is saved when submissions close (13 Oct, 23:59 ET) is the entry. Every block must be true of the product **as it stands** whenever it is pasted.

Rules for editing this file:
- Anything not live is marked **pending** in the field text. Flip a marker only when the thing works on the stated network.
- After any edit, run `python3 scripts/submission_counts.py`. It rewrites the character counts and fails if a field is over its limit. Counts are UTF-16 code units, which is how browsers count text fields.
- Never put claim links, invite secrets or keys in this file. The repository is public. Those go into the portal's private judge field only (marked below).
- Update this file in the same commit as any product change that makes a sentence here true or false.

Last updated: 6 Oct 2026. Product state: contracts, relayer and indexer in build; nothing deployed. Portal: only the repository URL is saved; the rest is pasted once contracts are deployed and verified on mainnet and core flows are live.

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
Characters: 4750 / 8000
```text
Plans is a group money pot for trips, festivals and anything friends plan together, including friends who live in different countries. It is a native Android app on Monad.

THE PROBLEM
A group plan runs on one person's card and a spreadsheet. One friend pays the villa deposit, another buys the festival tickets, and weeks later the group is still working out who owes whom, in three currencies. A shared bank account needs everyone to bank in the same country. A crypto wallet needs everyone to manage seed phrases and gas. Neither works for a group chat of friends.

WHAT PLANS DOES
Each item shows its build status. "Pending" means designed and specified, not yet live.

1. Join with one fingerprint (pending). An invite link opens the app and a passkey creates the account: no seed phrase, no password, no gas token. The same passkey restores everything on a new phone.
2. One shared pot in digital dollars (pending). Members add AUSD from wherever they live and see the same balance in their own currency.
3. Rules the group sets, enforced by the pot contract (pending): an instant-spend limit, approvals above it (one other member, or a majority), budgets per category (stay, travel, food, tickets and more), caps per person per day, who can be paid, a pause any member can press, timelocked rule changes and an end date. A spend that breaks a rule is rejected by the contract, not by our server.
4. Live spending (pending). Every spend, approval and top-up appears on every member's phone within about a second, with a receipt photo and note encrypted so only the group can read them.
5. Paying people outside the group (pending). Reimburse the member who paid on their card, pay a business that accepts AUSD on Monad, or send anyone a claim link: they open it, make a passkey and claim, in any country. Unclaimed links refund to the pot.
6. Send across borders (pending). A Send tab moves AUSD directly between people, with the sender's and the receiver's currency and the reference exchange rate on the receipt.
7. Disputes, early exit and refunds (pending). Any member in a split can dispute a spend and the others vote. Exits and refunds follow fixed onchain formulas.
8. Settle up in one tap (pending). After the end date any member taps Settle up. One transaction pays everyone what they are owed and collects from anyone who owes, through a capped allowance they agreed to when joining, across countries. No organiser, server or admin key is needed.

HOW IT WORKS (design; all pending)
- Accounts: Mera, by Category Labs, is the entire account layer. Each person's signing key comes from their passkey's WebAuthn PRF output. There is no custody backend and no other wallet SDK.
- Money: AUSD by Agora on Monad mainnet. Deposits and sends use AUSD's ERC-3009 signed transfers. Every other action is an EIP-712 message to the pot. A relayer pays gas, so users never hold MON. Anyone can submit these signed messages; the relayer is a convenience, not a gatekeeper.
- Contracts: a factory that deploys one pot contract per plan, a key registry, a send router and a claim escrow. No admin keys. Unit, fuzz and invariant tests, including the invariant that members' balances always sum to the pot's balance.
- Privacy: a second passkey namespace (PRF salt "plans.keys.v1") gives each member an encryption key. Receipts, notes and names are encrypted to the group and decrypt on any phone where the same passkey signs in.
- Data: an Envio HyperIndex indexer derives per-member balances, category totals, the who-owes-whom settlement graph and cross-border volume by country pair. The app reads it over GraphQL and uses Monad websocket logs for the live feed.

WHY MONAD (measured on mainnet, 5 Oct 2026, 20:18 to 20:28 UTC)
- Blocks every 301 ms (median) and finality at 583 ms (median; 650 ms at p95). A spend reaches every phone before the spender looks up, and settlement is final before the phones stop buzzing.
- A relayed AUSD transfer was estimated at 112,910 gas, about $0.0004 at the time. At that cost the app can sponsor every tap, including approvals and votes.
- Each plan is a separate contract with its own storage, so many groups settling at once do not contend for the same state under Monad's parallel execution.
- eth_sendRawTransactionSync returns the receipt in the same call, so the app can show "done" without polling.

STATUS (6 Oct 2026)
Done: product specification, onchain rule set, architecture, live measurement of Monad mainnet, and simulated checks on mainnet that relayed AUSD ERC-3009 transfers and permits work.
Pending: contracts, relayer, indexer, Android app, mainnet deployment.
Live on mainnet: nothing yet. This description is updated as each part ships, with contract addresses and transaction hashes.
```

### Go-to-market and user acquisition strategy

<!-- field: Go-to-market and user acquisition strategy | limit: 8000 -->
Characters: 4029 / 8000
```text
FIRST USERS
Friend groups that already collect money in a group chat for a trip or a festival, with at least one member living in another country. For example: students and young professionals in the UK and US travelling with friends from home in India or Nigeria, or a mixed group going to a festival together. Each group has one organiser who brings 4 to 8 people, so every plan is its own small acquisition loop.

Plans has no card or bank on-ramp yet. So the first people who can fund a plan on day one are those who already hold digital dollars or have an exchange account: the Monad community, and crypto-native friends who organise trips for friends who are not. They are the beachhead. Their friends are the users who never see a blockchain.

CHANNEL
1. The invite link. Every plan is made to be shared in an existing group chat. The link opens the app, or the download page if it is not installed. This is the core channel and costs nothing per user.
2. Organisers first. We recruit organisers directly: Monad community channels (Discord and X), international-student societies and university travel groups in the UK and US, and festival group chats. The ask is one plan, not one install.
3. The settle-up moment as content. Each settlement can produce a shareable summary ("6 friends, 3 countries, settled in one tap"). That post is what brings the next organiser.

INSTALL TO FIRST FUNDED ACTION
The path we are building, and will measure step by step:
1. Tap the invite link in the group chat.
2. Install the Android app: an APK from our site during the hackathon, the Play Store after.
3. One fingerprint: account created and plan joined in a single onchain transaction.
4. First funded action: add money to the plan, or claim a link a friend sent. The organiser can send each member a claim link for their share, so a member with no dollars yet still completes a funded action with one more tap.
The two known friction points are the sideloaded APK and getting dollars without an on-ramp. The business path below addresses both.

MEASURED SO FAR (onchain, 6 Oct 2026)
Nothing is deployed yet, so every onchain number is zero. We report only numbers we can read onchain. From the first mainnet deployment, the public stats page (pending) and docs/traction.md in the repository will report these, straight from our Envio indexer:
- users: people who joined a real plan or sent money to someone
- plans created, and plans with at least one contribution
- members per plan, and countries per plan
- median time from joining a plan to its first funded action
- spends, approvals, settlements and settled volume
- cross-border volume by country pair
- APK downloads, from the GitHub release counter (offchain, labelled as such)
Demo accounts, plans that include them, and our own test accounts are excluded from every number.

PILOT BEFORE JUDGING (targets, not results)
Before 13 Oct: three real groups, at least 12 people across at least 3 countries, each running a small real plan on mainnet from invite to settlement. Results will be reported here and on the stats page as they happen.

PATH TO A BUSINESS
- Free for groups. Plans does not charge to create, join, spend or settle. Sponsoring every action of a six-person trip costs about three cents at the Monad fees we measured.
- Float income. Money sits in a pot for the length of a plan. AUSD is fully backed by short-term US Treasuries, overnight repo and cash, and Agora states that it shares the economics with partners who build with AUSD. A partnership would turn pot balances into revenue without charging users.
- Money in and out. Card and bank on-ramp and off-ramp through a licensed partner in each corridor, with a disclosed FX margin. This is also the fix for the biggest funnel friction.
- Organisers. Festival promoters, travel organisers and student societies running many plans get a paid tier: branded plans, bulk invites and exports for their accounts.
- After the hackathon: Play Store release, one on-ramp partner for the UK and US, then iOS.
```

### GitHub repository

<!-- field: GitHub repository | limit: 2000 -->
Characters: 36 / 2000
```text
https://github.com/Baskarayelu/plans
```

## Demo and pitch

### Live product

**Pending.** It will be the landing page with the APK download and live stats, at https://plans.0xo.in (the passkey domain; DNS record pending). The portal requires an https link that runs on Monad mainnet or testnet. Leave the field empty until the APK is downloadable from it.

### Technical demo video

**Pending.** Up to 3 minutes; the working product only, no slides or code walkthrough. Planned content: the "Three countries, one tap" sequence (join with one fingerprint, live spend, approval, one-transaction settle-up on mainnet).

### Pitch video

**Pending.** Up to 2 minutes: team (Baskar, solo), the problem, why now.

### Judge access instructions (optional, private to judges)

Mainnet funds and claim links are pasted into the portal only. The bracketed slots below mark where they go.

<!-- field: Judge access instructions | limit: 8000 -->
Characters: 4045 / 8000
```text
STATUS (6 Oct 2026): Plans is in build. The steps below describe the judge path being built. Each step stays marked pending until it works, and this field is updated as steps go live.

WHAT IS ON MAINNET
- Monad mainnet (chain 143): Plans contracts are pending, not deployed yet. Their addresses and sample transactions will be listed here and in the repository README.
- Money is AUSD at 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a, Agora's official Monad deployment.
- Demo funds on mainnet are deliberately small: judge claim links of $0.50 each and a judges' plan holding $2 (pending).
- Gas is paid by our relayer. You never need MON.
- Monad testnet: a separate testnet build with free test dollars, for unlimited experimenting (pending).

WHAT YOU NEED
- An Android phone, Android 9 or newer (10 or newer recommended). Works the same in the US and the UK. No SIM, VPN or local account needed.
- The phone signed in to a Google account, with a screen lock (PIN, fingerprint or face). Plans saves your passkey in Google Password Manager. If the phone asks where to save the passkey, choose Google Password Manager: some other password managers do not support the passkey feature Plans needs.
- About 10 minutes.

1. INSTALL (pending)
Open https://plans.0xo.in on the phone (pending) and download the Plans APK (its SHA-256 is shown on the page). When Android asks, allow your browser to install unknown apps, then tap Install. If Google Play Protect says the developer is unrecognised, tap More details, then Install anyway.

2. CREATE YOUR ACCOUNT (pending)
Open Plans, tap Create account and confirm with your screen lock. Enter a name and pick your country. That one prompt is the whole sign-up.

3. GET DEMO DOLLARS (pending)
Open one of the claim links below on the phone. Each holds $0.50 in AUSD on mainnet and can be claimed once. Tap Claim; your balance shows $0.50 within about a second. If a link is already used, take the next one. Unclaimed links return to the sender after 31 Oct.
[Claim links: added in the portal only, at release.]

4. JOIN THE JUDGES' PLAN (pending)
Open [judges' plan invite link: portal only, at release] and tap Join. You are now a member of "Metropolis Judges' Trip", with demo members in London, New York and Bengaluru. On this plan, spends up to $0.25 go through instantly and larger spends need one other member's approval.

5. CORE FLOW (pending)
a. Add $0.25 to the plan with Add money. The pot balance updates on screen.
b. Pay $0.10 from the pot to Asha (Bengaluru), category Food & drink, split with everyone. It goes through instantly and appears in the feed.
c. Try a $0.40 spend. The app shows "Needs 1 more approval". The demo member Ben (London) approves within about 10 seconds and the spend goes through. Ben, Asha and Maya are demo accounts run by our relayer so that one judge with one phone can see approvals and settlement. The app labels them "Demo", and they are never counted in our user numbers.
d. Open Send, pick Asha (Bengaluru) and send $0.05. The receipt shows dollars and rupees, with the reference rate.
e. On the home screen tap "Try a settle-up". It creates a short plan with the three demo members, adds a few spends, and lets you press Settle up. One transaction pays everyone. Tap Proof on any receipt to see the transaction on a Monad explorer.

6. FRESH-DEVICE TEST (pending)
Go to Android Settings > Apps > Plans > Storage > Clear storage. Open Plans, tap "I already use Plans" and confirm with your screen lock. Your account, plans, balances and encrypted receipts come back, rebuilt from your passkey alone. The key fingerprint (three emoji under Profile) matches the one before.

IF SOMETHING FAILS
- "Passkey not supported": make Google Password Manager your passkey provider (Android Settings > Passwords and accounts), then retry.
- A link opens in the browser instead of the app: tap "Open in Plans" on the page, or copy the link and paste it into Plans > Join.
- No test login is needed or possible: Plans accounts are passkeys you create on your own phone.
```

## Bounties

The portal does not state a limit for bounty answers. They are kept under a self-imposed 3,000 characters, which the counter checks.

### Recommended selection (6 Oct 2026)

| Bounty | Add? | Why |
|---|---|---|
| Agora: Best Cross-Border Payments App on Monad | **Add now** | Track 02 only, which is our track. Send and cross-border settle-up are core flows. |
| Monad Foundation: Best Mera-Powered UX on Monad | **Add now** | Mera is the only account layer. |
| Monad Foundation: Mera: One Passkey, Many Keys | **Add now** | The `plans.keys.v1` namespace does the encryption work. |
| Envio: Best Use of Envio | **Add now** | Balances, the settlement graph and corridor stats come from HyperIndex. |
| Aurora Intents: Bring Any-Chain Liquidity to Monad | **Do not add yet** | Every Monad route was unavailable when re-tested on 5 Oct, 20:59 UTC, and Aurora lists no AUSD. Re-test on 10 Oct. |

### Agora: Best Cross-Border Payments App on Monad

**Asked at submission:** "Describe the core features of your app with a focus on how it enables a user to send AUSD to another person or across borders"

<!-- field: Agora: core features answer | limit: 3000 -->
Characters: 1319 / 3000
```text
Plans is a native Android app on Monad mainnet in which AUSD is the only money. Status (6 Oct 2026): designed and specified; every feature below is pending until marked live.

Sending AUSD to another person or across borders:
1. Onboarding with one Mera passkey prompt (pending). No seed phrase, password or gas token. A synced passkey restores the account on any phone.
2. Send tab (pending). Scan a friend's Plans code or pick a plan member, type an amount in your own currency, and confirm. The receiver sees it in theirs within about a second. The receipt shows both currencies, the reference exchange rate and its time, and a link to the Monad transaction.
3. Gasless (pending). The sender signs an AUSD ERC-3009 authorisation and our relayer submits it, so neither side holds MON. On mainnet a relayed AUSD transfer was estimated at 112,910 gas, about $0.0004.
4. Send by link (pending). Send AUSD to someone who has no account yet, in any country. They open the link, create a passkey with one prompt and claim. Unclaimed money returns to the sender.
5. Group money across borders (pending). Members in different countries fund one AUSD pot, spend from it under rules the group sets, and settle in one transaction that pays London, New York and Bengaluru in the same block. Monad finality measured 583 ms median.
```

**Demo video (required, up to 2 minutes): pending.** You will send the brief. The app must provide this exact path on mainnet, uninterrupted, between two members in different countries:

1. **Phone B ("Sam, New York"), fresh install:** Create account, one fingerprint, country United States. Home shows $0.00. *(passkey onboarding)*
2. **Phone A ("Leah, London"), funded beforehand by claim link:** home shows "$3.00 · £2.2x", with the caption "Digital dollars (AUSD)". *(AUSD balance)*
3. **Phone B:** Profile, then "My Plans code".
4. **Phone A:** Send, scan Sam's code, enter £1.00. The app shows "Sam gets $1.3x". Confirm.
5. **Phone B buzzes** "+$1.3x from Leah, London" within about a second. Its balance updates. The receipt shows both currencies, the reference rate, "Settled in 0.x s" and a Proof link to the mainnet transaction. *(completed send and receive, settled instantly)*
6. **Optional:** Sam sends $0.50 back and Leah's phone receives it.

Funding: Leah's account is funded with a $3.00 claim link from the Plans treasury, so its address doesn't need to be known in advance. Leah and Sam are team test accounts, listed in `indexer/internal-accounts.json` and excluded from every number.

### Monad Foundation: Best Mera-Powered UX on Monad

**Asked at submission:** "Describe how your project meaningfully integrates Mera as the entire account layer"

<!-- field: Mera UX: account layer answer | limit: 3000 -->
Characters: 1434 / 3000
```text
Mera is the only account layer in Plans: no Privy, no Dynamic, no injected wallet, no custody backend. Status (6 Oct 2026): designed and specified; each item below is pending until marked live.

- Create (pending): createPasskeyWithPrfOutput makes a discoverable passkey on Android's Credential Manager through react-native-passkey. Its PRF output, under Mera's default salt, derives the user's key via Mera's documented recipe.
- Restore (pending): getPasskeyPrfOutput with no stored credential opens the system passkey picker and returns the same PRF output, so the same account, plans and receipts are rebuilt on a new phone or after app data is cleared. Nothing is kept on our servers. The app always tries to restore before offering to create, so a user never gets a second account by accident.
- Signing sessions (pending): one fingerprint per app launch opens a Mera secp256k1 signing session, and toViemAccount signs every EIP-712 action and AUSD ERC-3009 authorisation without further prompts: spends, approvals, votes, sends and settle-up. The session key lives in memory only and is ended when the app goes to the background for long.
- Joining a plan takes one prompt in total, including account creation for a new user.
- Gas never appears: signed messages go to our relayer, and users never hold MON.
- The UI never says wallet, address, gas or transaction. Users see "Confirm with fingerprint", "Done" and a Proof link.
```

**Optional video (up to 2 minutes): the join flow plus the stateless test.** Fresh install, open an invite link, "Join with fingerprint" (one prompt), then approve and spend with no further prompts. Then Android Settings > Clear storage, reopen, "I already use Plans", one prompt, and everything is back. Pending.

### Monad Foundation: Mera: One Passkey, Many Keys

**Asked at submission:** "Describe how your project meaningfully utilizes Mera in non-account work."

<!-- field: Mera Many Keys: non-account work answer | limit: 3000 -->
Characters: 1419 / 3000
```text
Namespace: plans.keys.v1, a PRF salt of SHA-256("plans.keys.v1"), separate from the default salt that derives the account key. It never signs a transaction. Status (6 Oct 2026): designed and specified; pending until marked live.

What it does:
1. Group encryption identity. HKDF over the plans.keys.v1 output gives each member an X25519 key pair. The public key is registered when they join a plan. Each plan has a random group key, sealed to every member's X25519 key. Receipt photos, spend notes and member names are encrypted with the group key, so only the group can read them; the chain and our servers see ciphertext only.
2. Local cache key. A second HKDF branch encrypts the app's on-device cache, so a copied phone backup reveals nothing.
3. Cross-device proof. The same passkey on a second phone re-derives the same X25519 key. The app shows its fingerprint as three emoji, identical on both phones, and old receipts decrypt there with nothing transferred between devices.

How it is evaluated: a Mera WebAuthn client wrapper asks the authenticator for both salts in one ceremony (the WebAuthn PRF "first" and "second" inputs), so joining a plan stays at one fingerprint. If a phone's passkey provider returns only one output, the app asks for a second fingerprint the first time encrypted content is opened on that phone. Encryption uses @noble X25519 and XChaCha20-Poly1305, because Hermes has no WebCrypto.
```

**Optional video (up to 2 minutes): the cross-device key test.** Phone 1 shows the plan's encrypted receipt and the key fingerprint emoji. Phone 2 signs in with the same passkey (one prompt), shows the same fingerprint and opens the same receipt. Pending.

### Envio: Best Use of Envio

**Asked at submission:** "Describe how your project meaningfully uses Envio's HyperIndex, HyperSync or HyperRPC to power real on-chain data in your app — not just installed, but actually driving a feature."

<!-- field: Envio: usage answer | limit: 3000 -->
Characters: 1282 / 3000
```text
An Envio HyperIndex indexer on Monad mainnet (chain 143) is the app's data layer for everything except the sub-second live feed. Status (6 Oct 2026): designed and specified; pending until marked live.

Schema: Pot, Member, Contribution, Spend, Proposal, Approval, PersonalExpense, Dispute, DisputeVote, RuleChange, KeyWrap, Send, Claim, Settlement, Payout and Debt, linked with @derivedFrom. Handlers maintain derived entities:
- MemberBalance: each member's live net position in a plan. It drives the "You're owed £18" strip on every plan screen.
- CategorySpend: spend against each category budget. It drives the budget bars and the warning before a spend would break a budget.
- SettlementEdge: the minimal who-owes-whom graph, recomputed on every spend. It drives the Settle up preview, before any money moves.
- Corridor: AUSD volume and count by country pair. It drives the public stats page.
- PotDaily: a daily time series per plan for the plan summary.

The app queries Envio's GraphQL for plan lists, history, balances and the settle-up preview. A fresh-device restore rebuilds a user's plans from Envio by their address, because the public RPC limits log queries to 100 blocks. Monad websocket logs give the instant buzz; Envio gives the history and every derived number.
```

**Optional video (up to 2 minutes): spend to settle-up preview.** Make a spend on the phone. A split screen shows the Envio GraphQL console with the new Spend, then the updated MemberBalance and SettlementEdge entities. Back on the phone, the "Who owes whom" screen updates. Pending.

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
| X profile link for the project | **Pending.** No project X account exists. You would need to create it. |
