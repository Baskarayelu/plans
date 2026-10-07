# Video storyboards

Living document. Nothing is recorded until the flows exist on the network named in each shot. Each shot lists what must be live first. Timings are targets.

Status key: **ready** (exists on testnet now) · **pending** (not built or not deployed yet).

---

## 1. Agora bounty video (required, at most 2:00)

The bounty requires three things on screen: passkey onboarding, an AUSD balance, and a completed send and receive settled instantly, between two members in different countries.

Recorded on **mainnet** after go-live, with smallest amounts. Two phones side by side (or two emulators), one continuous take.

| Time | Phone A: Leah, London (funded by a $3 claim link beforehand) | Phone B: Sam, New York (fresh install) | Proves | Status |
|---|---|---|---|---|
| 0:00–0:08 | Title card over both home screens: "London → New York, one fingerprint each" | — | Context | pending |
| 0:08–0:30 | — | Open Plans, **Create account**, one fingerprint, pick United States. Home shows $0.00 | **Passkey onboarding** | pending (needs mainnet) |
| 0:30–0:42 | Open the **Send** tab: "$3.00 · £2.2x", captioned "Digital dollars (AUSD)", with the Agora backing line | — | **AUSD balance** | pending |
| 0:42–0:52 | — | You → My Plans code (QR) | — | pending |
| 0:52–1:15 | Scan Sam's code, enter £1.00, see "Sam gets $1.3x" and the reference rate, confirm with fingerprint | — | Send | pending |
| 1:15–1:30 | — | Buzzes: "+$1.3x from Leah, London". Receipt shows both currencies, reference rate, "Settled in 0.x s", Proof | **Completed receive, settled instantly** | pending |
| 1:30–1:45 | Tap Proof: the Monad explorer shows the transaction, final | — | Onchain proof | pending |
| 1:45–2:00 | End card: "Mera passkeys · AUSD on Monad · settled in under a second" | — | — | pending |

## 2. Technical demo (required, at most 3:00)

Must show the live, working product and Monad transactions (rules §4.1): no slides or code walkthrough. Recorded on the network that's live at submission (mainnet if the go-ahead comes in time, otherwise testnet, stated on screen).

| Time | Shot | Proves | Status |
|---|---|---|---|
| 0:00–0:15 | Three phones (London £, New York $, Bengaluru ₹). A judge-style "Join with fingerprint" from a WhatsApp invite link | One-prompt join across countries | pending |
| 0:15–0:40 | Add money on each phone; the pot balance updates on all three within a second | Live feed, sub-second blocks | pending |
| 0:40–1:05 | Pay $36 dinner from the pot (instant); then try a $250 boat trip: "Needs 1 more approval"; the second phone approves with a thumb; it executes | Onchain rules: tiers, approvals | pending |
| 1:05–1:20 | Try to overspend the Food budget: the contract refuses, with a plain-English reason | Rules enforced by the contract, not the app | pending |
| 1:20–1:40 | Clear the app's storage on one phone, then "I already use Plans": account, plans and an encrypted receipt come back; the key fingerprint matches | Mera stateless test; One Passkey, Many Keys | pending |
| 1:40–2:10 | Plan ends → "Looks right" on each phone → **Settle up**: one transaction, three phones buzz with payouts in £, $ and ₹; "Settled in 0.x s" | One-transaction settlement across borders | pending |
| 2:10–2:30 | Share the settle summary; open the public proof page; tap through to the transaction on the explorer | Proof page, shareable | pending |
| 2:30–2:50 | Laptop: the same plan in the web app, full-screen layout | Web app parity | pending |
| 2:50–3:00 | End card: numbers (finality, cost per action), repo, @PlansOnMonad | — | pending |

## 3. Pitch video (required, at most 2:00)

Team, problem, why us. **Generated voice, no one on camera**: the founder story is told in the first person by the voiceover and carried by visuals (a group chat, a spreadsheet, a map, the product). The script is written and approved first; the voice is generated from the approved script only. On-screen credit at the end: "Voice generated; story and words by Baskar A".

| Time | Voiceover beat | Visuals | Notes |
|---|---|---|---|
| 0:00–0:15 | Who Baskar is and the moment that started it: a trip with friends in different countries, one person's card, a spreadsheet, weeks of chasing | Animated group chat with "who paid for what?" messages; a spreadsheet filling with red cells; three flags on a map | Real story only, in his words |
| 0:15–0:35 | The problem: every group-money product stops at a border or a bank; shared pots need you to trust the admin | Side-by-side cards for Monzo, Wise and Revolut pots, each with its limit stamped on | Cite limits from `research/block4/best-in-class.md` |
| 0:35–0:55 | Zeel Patel's request, and Plans as the answer | The request as a quote card: under 15 words, attributed; then the Plans wordmark | Quote under 15 words |
| 0:55–1:20 | The product in 25 seconds: join with a fingerprint, rules the pot keeps, settle in one tap across countries | Clips from the technical demo (three phones), with no faces | Reuse demo footage |
| 1:20–1:40 | Who it's for and how the next 100 users arrive: cross-country friend groups, festivals and trips; the invite link and the settle summary as the loop; pilot results | Invite link landing in a chat; the proof page; pilot numbers as counters | Only real pilot numbers |
| 1:40–2:00 | Why Monad (sub-second final settlement, cost per action) and what's next (iOS, card top-up partner) | The measured stats from plans.0xo.in; end card with the repo and @PlansOnMonad | — |

## 4. 30-second product clip (optional)

Cut from the technical demo: join → pay → contract refuses → settle in one tap → proof page. Silent, captioned.
