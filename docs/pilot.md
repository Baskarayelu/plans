# Pilot kit

**Goal:** three real groups, at least 12 people, across at least 3 countries, all on Android, each running one small real plan on Monad mainnet from invite to settle-up.

Until a pilot has happened, the submission text describes it as a **target**. Once it has, the measured results replace the target, read from the indexer (see [traction.md](traction.md)).

Status: **not started.** It waits on the release checklist at the end of this file.

---

## 1. Message to send in the group chat

Send this from your own phone, after the group agrees to try it. Replace the bracketed parts.

> Hey! For [trip / festival / dinner], let's try **Plans**: one shared pot for the group, even though we're in different countries.
>
> 1. Install the app (Android only for now): [download link]
> 2. Tap this link to join our plan: [invite link]
> 3. Confirm with your fingerprint. That's your account, done.
> 4. Tap the gift link I'll send you. It puts **$0.50** in your Plans balance so you can try it.
>
> We'll pay for small things from the pot, see every spend straight away, and settle up with one tap at the end. Takes 2 minutes.

A shorter version for a second nudge:

> Plans link for [plan name]: [invite link]. Install from [download link], tap the link, use your fingerprint. 50¢ gift link coming.

## 2. What a pilot user does, from link to settled

Screenshots are **pending**. They are added from the emulator test run once the app exists, one per step.

| # | Step | What they see |
|---|---|---|
| 1 | Install the APK from the download page | Android asks to allow installs from the browser, then Install |
| 2 | Tap the invite link in the group chat | The plan opens: name, dates, who's in, the rules in plain words |
| 3 | Tap **Join with fingerprint** | One fingerprint prompt. Account created and plan joined. |
| 4 | Pick their country and currency | Shown once, the first time |
| 5 | Tap the gift link from the organiser | "You received $0.50", balance updates within a second |
| 6 | **Add money** to the plan: $0.30 | Pot balance goes up on every phone |
| 7 | Organiser pays a small thing from the pot (for example a $0.12 sweet, split with everyone) | It appears on every phone within a second |
| 8 | Someone proposes a bigger spend, for example $0.40 (over the $0.25 instant limit); another member taps **Approve** | It goes through when approved |
| 9 | One person sends $0.05 to a friend in another country from the **Send** tab | The receipt shows both currencies |
| 10 | When the plan ends, everyone taps **Looks right**, then anyone taps **Settle up** | One tap. Everyone sees their share back in their own currency. |

The pilot plan uses the **Pilot** rules preset:
- Up to $0.25 goes through instantly.
- Up to $1.00 needs one approval.
- The plan ends after 48 hours, with no review window.

Worked example for a group of four: each adds $0.30, so the pot holds $1.20. The $0.12 and $0.40 spends leave $0.68, which settle-up pays back. Each person also keeps $0.20 in their own balance, enough for the $0.05 send. Every step works on a $0.50 start.

## 3. The 50¢ start, and what the pilot costs

- Each pilot person gets one **$0.50 claim link** from the Plans treasury. You send it in the chat after they've joined.
- A link that isn't claimed within 7 days can be refunded to the treasury: `scripts/return-funds.mjs` refunds every expired link (see [mainnet-launch.md](mainnet-launch.md), step 14).
- Funding is stage 3 (see [funding.md](funding.md)). It is sent only when you confirm the groups: **$0.50 × confirmed pilot users**. For example, 12 people is $6.00 and 15 people is $7.50.

| Item | Amount |
|---|---|
| Claim links | $0.50 per confirmed pilot user |
| Network fees | about 12 actions per person (~2.7 MON for 15 people), paid by the relayer out of the stage 1 MON |

Money that is claimed belongs to the pilot user. At settle-up it goes back to them, not to the treasury, so claimed money counts as spent.

## 4. What to collect from each group

Collect this privately, for example in a note on your phone. **Do not put names or phone numbers in this repository.** It is public.

| Per person | Why |
|---|---|
| First name or nickname | So you know who has joined |
| Country they live in | Corridor stats; checks the "3 countries" target |
| Android version (Settings > About phone) | Must be Android 9 or newer; we track failures by version |
| Phone make and model | Some phones handle passkeys differently |
| Google account signed in, and a screen lock set? (yes/no) | Passkeys need both |

| Per group | Why |
|---|---|
| Plan name and dates | So we can match it to the plan on the stats page |
| Anything that went wrong, in their words | Fixes before judging |

Once a group has settled, send me the plan's name. I will:
- confirm it appears on the stats page;
- add the group's anonymised result (people, countries, time to first funded action, settle-up time) to [traction.md](traction.md);
- update the go-to-market text in [submission.md](submission.md).

## 5. How pilot results reach the stats page

- The stats page reads straight from the Envio indexer. Pilot people are real users, so they **are counted**.
- What is **never counted**:
  - The demo accounts (Ben, Asha, Maya).
  - Any plan containing a demo account.
  - Our own test accounts. These are listed in `indexer/internal-accounts.json`, so the emulator test accounts go there before the pilot starts.
- Metrics shown for the pilot (definitions in [traction.md](traction.md)):
  - plans created and funded;
  - people;
  - countries per plan;
  - median time from joining to the first funded action;
  - settlements;
  - cross-border volume by country pair.

## 6. What must work before the first pilot group starts

- [ ] Contracts deployed and verified on Monad mainnet; addresses in the README.
- [ ] Relayer live on Railway with funded keys. Health endpoint is green from a UK and a US network.
- [ ] Envio indexer live on mainnet. Stats page shows real counts, excluding internal and demo accounts.
- [ ] `plans.0xo.in` serves the download page and `/.well-known/assetlinks.json`; Android verifies the app link.
- [ ] Signed release APK published. Install works on a clean Android 14+ emulator and on one physical phone.
- [ ] One-prompt join works on a fresh emulator: passkey created, account and plan joined in one transaction.
- [ ] Claim link flow works on mainnet: create from treasury, claim on a new account, unclaimed refund.
- [ ] Spend instant, spend with approval, cross-border send with both currencies, settle-up in one transaction: all pass in the automated emulator run on mainnet.
- [ ] Clear storage and restore works. The encrypted receipt opens on a second device.
- [ ] Push notifications arrive for approvals and settle-up.
- [ ] Pilot rules preset available in the app.
- [ ] Treasury funded with the pilot AUSD; claim links generated and stored privately for you (`scripts/claim-links.mjs --count <n> --expiry <7 days out>`, written to `../secrets/` only).
