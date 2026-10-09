# Stage B run: 9 Oct 2026, public Monad testnet

Three people on one plan, end to end: two Android emulators running the new Plans Test APK and the
live web app at https://plans.0xo.in/app. Every transaction below was checked with `cast receipt`
(status 1). Times are IST (UTC+5:30) on 9 Oct 2026 unless marked UTC.

## Results

| # | Step | Device(s) | Result |
|---|---|---|---|
| 1 | Android first transaction timing | play35-a | **PASS, existing-passkey variant**: 9 taps + 1 fingerprint, 88.2 s wall clock (automated), about 18 s of app waits. A first-ever account could not be measured (see step 1) |
| 2 | Three people: plan, invite, join, test dollars, add money | play35-a, play35-b, web | **PASS** |
| 3 | Instant spend, approval spend, cross-border send, receipt with both currencies and the rate line | play35-a, play35-b, web | **PASS** |
| 4 | Link a browser, with a real camera scan | play35-a + a second Chrome context | **PASS, real camera scan** (emulator back camera fed from an image file of the browser's QR) |
| 5 | Sign in on a computer with a phone's passkey (hybrid) | Mac Chrome + play35-a | **BLOCKED** (emulator Bluetooth is simulated; headless Chrome has no hybrid dialog) |
| 6 | Settle-up with a recorded rate round | all three | **PASS**: `Settled.fxRoundId = 6` |
| 7 | `collect(member)` through the app's Collect banner | play35-a, play35-b | **PASS**: two `Collected` events (1 unit each, the only claim the contract can leave on testnet; see step 7) |
| 8 | Restore on a second device | play35-a (storage cleared) | **PASS**, storage-clear variant. Install on play35-c **BLOCKED**: not enough disk space to boot it |
| 9 | Plan lists and balances from the self-hosted indexer, web and APK | all | **PASS** |

Bugs and findings: 11 (2 fixed and pushed before the build, 9 recorded below). Relayer gas for the run's 25
transactions: 0.4166 MON (charged on gas limits).

## Setup

**APK** (not published; the lead publishes it):

| | |
|---|---|
| Name, version | Plans Test 1.0.0 (versionCode 1), package `in.oxo.plans.test` |
| Built from | a clean `git worktree` of origin/main at `5fe3a7f`, `app/node_modules` symlinked, `bash app/scripts/build-apk.sh testnet release` with `PLANS_SECRETS_DIR` pointing at `../secrets` (478 s) |
| sha256 | `32ef9b2eb439e2eaba40f36841152b0da5907c5e215157228d23d0b392367bca` |
| Size | 89,248,238 bytes |
| Signer | SHA-256 `80:79:E1:B7:EA:A6:65:F8:…:81:E1:CD`, the certificate `assetlinks.json` lists for both packages |
| Config inside | relayer `https://relayer-production-ecef.up.railway.app`, indexer URL from the relayer's `/v1/config`, chain 10143, contracts from `deployments/10143.json`; `PlansNative` linked (logcat marks work) |

Two build bugs had to be fixed first (both pushed, both with tests in `app/src/__tests__/buildScripts.test.ts`):

- `7512c43`: `build-apk.sh` didn't set the relayer URL the way `build-web.sh` does, so a plain run baked in
  app.config.ts's default `relayer-testnet.plans.0xo.in`, which has no DNS record: an APK that can't reach
  the chain. The script now defaults it like the web build and refuses an APK whose embedded config
  doesn't name it. (The published test.2 APK had the right URL: it was built with the variable set.)
- `5fe3a7f`: `app/.gitignore`'s unanchored `android/` rule also ignored
  `app/modules/plans-native/android/`, so the PlansNative module's Android sources were never committed.
  A clean checkout (the first build, `7512c43`, sha256 `53e96ed0…`) produced an APK without it: no
  `PLANS_TIMING` / `PLANS_PRF` logcat lines, no native share or save of the settle-up card. The rule is
  now `/android/`, and the module's `build.gradle`, manifest and `PlansNativeModule.kt` are in git.

**Live services**: relayer healthy (lanes 0.691 / 0.732 / 0.781 MON before, 0.533 / 0.550 / 0.657 after);
indexer `https://hasura-production-c5c7.up.railway.app/v1/graphql` synced; FX round 6 (scheduled
06:03:55 UTC, written by the launchd job) was 2.6 h old at settle-up; web app build `2026-10-08T20:29:53Z`.

**Devices**: play35-a (emulator-5582, started with `-camera-back imagefile:<png>`), play35-b
(emulator-5584), both Android 15 with Google Play, PIN 1111, fingerprint 1. Web people: headless Chrome
(system install) driven with the `e2e/web/lib` helpers, each in its own browser context with a CDP
virtual passkey (PRF), 1440 px laptop layout, live site (nothing intercepted).

Environment notes:
- The emulators' Wi-Fi network had no IPv4 default route (only the cellular `eth0` did), so the app could
  not reach the relayer, indexer or RPC ("Couldn't load your plans", balance "…"). Fixed by
  `svc wifi disable` on both emulators; they used the emulated mobile network for the rest of the run.
- Both emulators are signed in to the owner's Google account, so they share one Google Password Manager.
- The session was paused for about 10 hours between 02:40 and 12:43 IST; the run itself is 13:33–14:32.

## People and plan

| | Name | Device | Account | Country, money | Key |
|---|---|---|---|---|---|
| A | Sam | play35-a, APK | `0x7188C3Ae191a495a6F056d96E12e7f85309E630D` (the passkey already in the owner's password manager) | US, $ | 🦉🐤🥀 |
| B | Leah (London) | play35-b, APK | `0xa1f3a5c73ca5588e5c2594b7ec441da4d7a58a19` (new passkey) | GB, £ | — |
| C | Asha (Bengaluru) | live web app | `0x91436efcddc6a538f104a280fdac5872be5380d6` | IN, ₹ | 🐰🍃🔦 |
| D | (A's account) | second Chrome context, linked in step 4 | same as A | | 🦉🐤🥀 |

Plan **"Stage B trip"**, pot `0x7d446aa841ed3b961bf37b248d1e076d368cc89e`: Pilot rules (instant up to
$0.25, one OK up to $1, majority above; 48 hours from 13:46 IST, so today is inside the dates; no review
window). A put in $0.10 and turned the creator's safety net off; B and C joined with the default $5
safety net.

## Steps

### 1. Android first transaction timing (play35-a) — PASS, existing-passkey variant

Fresh install (uninstall, then `adb install` of the APK above), stopwatch from the tap on the app icon to
`faucet_ok` in logcat. `s1-steps.tsv` has the host time of every step, `s1-logcat-PLANS_TIMING.txt` the
app's marks.

| Step | Wall clock (s) | App marks |
|---|---|---|
| tap 1: open the app | 0.0 | app_boot +2.2 s, Welcome +2.3 s |
| tap 2: Create account | 11.7 | passkey sheet shown 4.1 s after the tap ("slow") |
| fingerprint | 34.2 | account open (route `/restored`) 9.8 s after the fingerprint |
| tap 3: Allow notifications (Android's first-run prompt) | 53.3 | |
| tap 4: Continue ("Welcome back") | 61.2 | profile 0.25 s later |
| taps 5–6: the name field, "Sam" (3 keystrokes), Continue | 69.8 | |
| taps 7–9: Add money, Get test dollars, Get $25 test dollars | 87.4 | each screen under 0.3 s |
| confirmed: faucet `0xdf7b1233…13c1b` | **88.2** | relay latency 0.68 s |

Totals: **9 taps, 3 keystrokes, 1 fingerprint; 88.2 s** wall clock, of which about **18 s** are the app's
own waits; the rest is the adb/uiautomator automation (2–5 s per screen read at load 13–15). The numbers
are in `docs/first-tx-timing.md` (Android section).

Why not a first-ever account: the owner's Google Password Manager (shared by the emulators) already
held a Plans passkey, so "Create account" showed "Use your saved passkey for Plans Test" and opened that
account (`s1-02`, black because Android hides the passkey sheet from screenshots, and `s1-03` "Welcome
back", $0.00, no plans). The Android app never offers to make a second account when one exists (the web
has the "I'm new to Plans" choice), so on these emulators only that account could be opened on play35-a.
An exploratory pass before the timed one (uninstalled afterwards) also showed the 13-second cold start of
the first build under load 50+, a "Google Play services isn't responding" dialog, and the Wi-Fi problem
above.

### 2. Three people (play35-a, play35-b, web) — PASS

- A, New plan → "Stage B trip" → Pilot → Put in now: Other $0.10 → safety net off → Create plan (no extra
  prompt in the unlocked session): `createPot` `0xc910d0cc…9d099`, `postKeyWraps` `0xd8b1d088…1fb5a`
  (`s2-01`–`s2-03`; the invite QR is blacked out because it carries the invite secret). The invite link
  was read from the QR on A's screen.
- App Links verified for `plans.0xo.in` on both phones (`pm get-app-links`).
- B, play35-b: the invite link opened in the app (`am start -d <link>`, like tapping it in a message) →
  "Join with fingerprint" → Google Password Manager "Create passkey to sign in to Plans Test?" →
  fingerprint → GPM asked once for another device's screen lock ("Enter your screen lock for the selected
  device", PIN of play35-a; account e-mail and device place blacked out in `s2-05`) → notifications Allow
  → profile Leah, United Kingdom, London → Join: `registerKey` `0x84fff94c…2267e`, `join`
  `0x07f1788a…0a28`, `postKeyWraps` `0x160c78eb…a9af` → "You're in! … 2 people · 2 countries"
  (`s2-04`–`s2-08`).
- C, web: opened `plans.0xo.in/app/j/<pot>#s=…` (the address bar is cleaned to `/app/join?pot=…&n=Sam`) →
  "Join with passkey" → profile Asha, India, Bengaluru → Join: `registerKey` `0x4609b888…cc05`, `join`
  `0xc6e63682…7375`, `postKeyWraps` `0x59e9add6…b903` (`s2-09`–`s2-11`).
- Test dollars and money in: A got $25 in step 1 and put in $0.10 at creation; B faucet
  `0x3469dc15…2ee2`, Add money $1.00 typed in dollars ("That's about £0.76"): `contribute`
  `0xa9db624b…af45`; C faucet `0x2c16c055…6122`, Add money $1.00 ("about ₹97"): `contribute`
  `0x2db1f539…f2fe` (`s2-12`–`s2-19`). A's plan home: "3 put in $2.10", +$0.10 / +£0.76 / +₹97.

### 3. Spends, cross-border send, receipt — PASS

- **Instant spend (A)**: Pay → Leah → $0.10 → Food & drink → note "Dinner at Taberna" → "Goes through now"
  → Confirm: `propose` (executed in the same transaction) `0x5b7aeb50…39f0`; receipt "Paid · Leah got $0.10
  … Settled in 0.1 s · Proof" (`s3-01`, `s3-03`).
- **Approval spend (B proposes, A approves)**: B, Pay → Asha → $0.40 (£0.30) → Tickets & activities →
  "Tram tickets" → "Needs 1 more approval … We'll ask Sam and Asha" → Ask for an OK: `propose` (pending)
  `0x38fed6ae…abe2` (`s3-04`, `s3-05`). A, Activity → "Needs you · 1: Leah wants $0.40 for Tram tickets ·
  1 of 2 OKs" → Review → Approve: `vote` (executes) `0x019fff3f…fddd2` → "Approved and paid · Asha got
  $0.40 · settled in 0.1 s" (`s3-06`–`s3-08`).
- **Cross-border send (A, US → C, India)**: C's Plans code link from the web (Receive → Copy link) opened on
  play35-a as an App Link → $1 → "Asha gets ₹97 · 1 USD = 96.7682 INR · Chainlink-fed reference rate,
  round 6" → Confirm: `send` `0x9b1c255c…4f87` (`s3-09`–`s3-11`).
- **Receipt with both currencies and the rate line** (`s3-12`): $1.00 → ₹97, From Sam · United States, To
  Asha · Bengaluru, Applied 1 USD = 96.7800 INR, Reference 1 USD = 96.7682 INR, Source Chainlink-fed
  reference rate round 6 (9 Oct 06:03 UTC), Difference +0.01%, Fee $0.00, Settled in 0.2 s, Proof. On
  chain, `Sent`: amount 1000000, US → IN, USD → INR, fxRateE8 9678000000, fxRoundId 6, refRateE8
  9676823137, fxDiffBps 1. C's web home then showed $25.40 · ₹2,458 and "Sam sent you $1.00 · +₹97"
  (`s3-13`).

### 4. Link a browser with a real camera scan — PASS

D, a new Chrome context (its own empty virtual passkey): Create account → nothing found → choice (166) →
"Link this browser" → step 1 "Save a passkey for this browser" → step 2 shows the QR, the code
`JQF0-Q9EA-235E` (one use, 10 minutes) and the pictures 🦕🐛🌼 (`s4-01`–`s4-03`).

On play35-a: You → Add a browser → camera permission "While using the app" → the scanner (expo-camera)
read D's QR **through the emulator's back camera**: play35-a was started with
`-camera-back imagefile:<png>`, the PNG being the QR element captured from D's page (`s4-00`). The
emulator re-reads the file every time the camera opens, so no restart was needed; the QR only had to sit
inside the part of the frame the portrait preview shows (two attempts showed it cropped, `s4-05`). Then
"Check the pictures: 🦕🐛🌼 · Says it's Chrome on a Mac · code made at 14:17" → "They match · Confirm with
fingerprint" → "Chrome on a Mac can now use your account" (`s4-06`–`s4-08`). D: "This browser is linked ·
Sam · your key 🦉🐤🥀 · Same as on your phone · Stage B trip", stored address `0x7188c3ae…630d` (A's), home
$23.83 with the plan (`s4-09`, `s4-10`). No transaction (the link goes through the relayer's slots).

### 5. Sign in on a computer with a phone's passkey (hybrid) — BLOCKED

Hybrid ("use a phone or tablet") needs (1) the computer's Chrome to show its own QR dialog, which the
phone scans, and (2) a Bluetooth Low Energy advertisement from the phone that the **computer's Bluetooth
radio** receives (the proximity check), before the tunnel through Google's server opens.

- (2) cannot happen with an emulator: Bluetooth is on in play35-a (`bluetooth_le` feature, virtual
  controller address `XX:XX:XX:XX:BB:BB`), but it is simulated by the emulator's `netsimd`, which connects
  emulated devices to each other only, never to the Mac's Bluetooth controller.
- (1) headless Chrome has no native passkey dialog: in a context with no passkey provider, "Create
  account" (and "Use a phone or tablet") just waits, and after 15 s the web app shows "The passkey step
  didn't open" (`s5-01`). A visible Chrome window was not opened on the owner's screen.

### 6. Settle-up with a recorded rate round — PASS

FX round 6 (scheduled 06:03:55 UTC) was 2.63 h old at the settle block (under 3 h, so `keep-fresh.sh` wasn't needed). C first added $0.01 more
(`contribute` `0xfded533f…4b92`) so the two creditors' claims differ (see step 7). Then:

- A: ⋯ → "End plan & check" → "End Stage B trip early? … You owe $0.07" → Looks right: `ack`
  `0x8a88725d…3d5f` (`s6-01`–`s6-04`).
- B: ⋯ → End plan & check → Looks right: `ack` `0xb585a02a…9e59` (2 of 3) (`s6-05`, `s6-06`).
- C (web): review → Looks right: `ack` `0x065dd51b…90fb` (3 of 3) → "See the settle-up" (`s6-07`–`s6-09`);
  `canSettle()` true.
- B: settle preview (`s6-10`, `s6-11`: GBP and INR rate lines, Chainlink-fed round 6) → "Settle up · one
  tap": `settle` `0xca48d73b…1f68` → "All settled · Settled in 0.3 s · $1.61 paid out · Leah £0.61 · $0.80
  · Asha ₹78 · $0.81 · Sam still owes $0.07" (`s6-12`).

On chain (decoded from the receipt): `Settled(by 0x03aa…a649 (relayer lane), paidOut 1609999, pulledIn 0,
unpaidClaims 66669, fxRoundId 6)`, `Payout` B 800198, `Payout` C 809801, `DebtRecorded` A 66668.
**fxRoundId = 6 > 0.**

### 7. collect(member) with the Collect banner — PASS

How a collectable claim arises on testnet: `payDebt` after settlement pays creditors at once
(`Pot.payDebt` → `_distribute`), so it does not leave money waiting for `collect`; a refused payout (the
mainnet case) needs AUSD's freeze, which only Agora controls. What remains is the floor of the pro-rata
maths: with unequal claims the settle-up leaves 1 unit in the pot, and the debt payment then leaves each
creditor 1 unit short, which only `collect` can pay. `potsim` (run against the pot before settling)
predicted every number below.

- Right after settle-up, B's plan home: "Settled on 9 Oct. Some money is still waiting to be collected ·
  £0.03 ($0.03) is still waiting for you · Collect it" and "Asha is still owed $0.03 · Send it to Asha"
  (`s7-01`). Tapping Collect it: **"There's nothing left to collect from this plan."** (the pot held 1
  unit; nothing was sent) (`s7-02`). See bug 3.
- A, Activity → "You owe $0.07 · Stage B trip is settled · pay to finish" → Pay now → debt screen "You owe
  Asha and Leah $0.07 … Everyone owed is paid straight away: Leah £0.03, Asha ₹3" → Pay now · $0.07:
  `payDebt` `0x0717d0b6…1c8f` → "All clear · Settled in 0.4 s" (`s7-03`–`s7-06`). On chain: `DebtPaid` A
  66668, `Payout` B 33135, `Payout` C 33532; B and C each still owed 1 unit, pot 2 units.
- B's plan home: "£0.00 ($0.00) is still waiting for you" (bug 4) → **Collect it** (`btn-collect`):
  `collect` `0xe9f09a4b…2049` = `Payout` B 1 + **`Collected(member B, by 0x03aa…a649, amount 1)`** →
  **Send it to Asha** (`btn-collect-91436e`): `collect` `0x5ab3e689…8d6b` = `Payout` C 1 +
  **`Collected(member C, by 0xe5ce…2662, amount 1)`** (`s7-07`–`s7-09`). The pot is empty and every net is
  0; the indexer shows both payouts with source `Collect` and `collectedBy`, and the plan now reads
  "Everyone was paid on 9 Oct." (`s9-04`).

### 8. Restore on a second device — PASS (storage-clear variant); play35-c BLOCKED

- play35-c would not start: "Your device does not have enough disk space to run avd: play35-c" — the
  Mac's data volume was 100% full (1.1 GB free, mostly other projects' files). I removed only my own build
  worktree (1.2 GB) and didn't touch anything else.
- Instead, as the brief allows, play35-a's app storage was cleared (`pm clear in.oxo.plans.test`) →
  Welcome → **I already use Plans** → the saved passkey + fingerprint → notifications Allow → "Welcome back,
  Sam · We found your Plans account and rebuilt everything · Stage B trip (Ended · 3 people) · $23.83 ·
  your key 🦉🐤🥀 · Same key as your other phone" (name rebuilt from the plan) → Go to my plans → the plan
  → the spend opens with its **encrypted note "Dinner at Taberna"**, split 3 ways ($0.03 / £0.03 / ₹3)
  (`s8-01`–`s8-04`).

### 9. Plan lists and balances from the indexer — PASS

| Who | Where | Balance shown | On chain | Plan list |
|---|---|---|---|---|
| A | APK, play35-a | $23.83 | 23.833332 | Stage B trip · Settled (`s9-02`) |
| B | APK, play35-b | $24.93 · £18.88 | 24.933334 | Stage B trip · Settled (`s9-01`) |
| C | web, after a full reload and unlock | $26.23 · ₹2,539 | 26.233334 | 1 plan · 0 active, Stage B trip · Settled · All square (`s9-03`) |
| D (A's account) | web, linked browser | $23.83 | 23.833332 | Stage B trip · Settled (`s4-10`) |

Plan homes, Activity, invite preview, review, settle-up and the debt screen all loaded from the
self-hosted indexer throughout (it was never more than a few seconds behind).

## Bugs and findings

Fixed (pushed, with tests): the two build bugs under Setup (`7512c43`, `5fe3a7f`).

Recorded, not fixed (not trivial, or they change copy or design):

3. **Collect banner ignores the pot's balance.** After a short settle-up it offers "Collect it" / "Send it
   to Asha" for the unpaid part although the pot is empty; the tap fails with "There's nothing left to
   collect from this plan." Its text ("Settle-up couldn't pay you this part at the time. Collect it now")
   is also wrong for this case: the rest waits for the debtor, and the debt payment pays creditors
   automatically. The banner should use the contract's amount (`net × min(balance, credit) / credit`) and
   say "waiting for Sam to pay" when it's 0. (`ui/plan/CollectBanner.tsx`, `lib/domain/collect.ts`)
4. **Sub-cent amounts show as $0.00**: "£0.00 ($0.00) is still waiting for you", "Asha is still owed $0.00",
   recent money "+$0.00".
5. **Settle preview contradicts itself when the pot is short.** "How we got there" draws Sam → Asha $0.07
   and says "Then the $1.61 left in the pot goes to you £0.63 and Asha ₹75", while the rows (and the
   contract) pay pro rata: Leah £0.61 with $0.03 still owed, Asha ₹78 with $0.03 still owed, and the debt
   is later split 33,135 / 33,532 between both (`s6-10`).
6. **Stale Welcome screen after joining from a link**: on play35-b, a cancelled "Create account" left
   Welcome ("No account was made") under the invite flow; Back from the plan home after joining returned to
   it although the account existed (`s2-12b`).
7. **Debt screen band says "Ended 11 Oct · settled"** for a plan ended early and settled on 9 Oct.
8. **Web copy**: the stuck notice on a computer says "Your phone is taking too long to show it" (`s5-01`);
   the web join screen says "You'll make a Plans account with your fingerprint" above "Join with passkey".
9. **Android "Create account" can't start a second account** on a phone whose password manager already
   holds a Plans passkey (no equivalent of the web's "I'm new to Plans"); combined with emulators sharing
   one Google account this kept step 1 from measuring a brand-new account. All Plans passkeys are also
   named "Plans", so a phone holding two would show two identical entries.
10. **No prompt for the others when someone starts "End plan & check" early**: B and C had to open ⋯ →
    End plan & check themselves (no banner on the plan home).
11. **"Confirm with fingerprint" doesn't ask for one** inside an unlocked session (spend, approve, send,
    settle, pay debt, collect). This matches `app/docs/crypto.md` (one fingerprint per app launch; locks
    after 10 minutes in the background), but the button label promises a check that doesn't happen.

## Transactions (all `cast receipt` status 1)

| Step | Device | Action | Transaction | Status | Block |
|---|---|---|---|---|---|
| 1 | play35-a | faucet (A test dollars) | `0xdf7b1233b2efa51d815834e6b13eacd47fc6573d7527c0bbe0e771ba97113c1b` | 1 (success) | 69488672 |
| 2 | play35-a | createPot (A, $0.10 in, Pilot, safety net off) | `0xc910d0cc8d63ad32866f5b8225e43eb4b80cd2a047334aa30a423e0b567d9099` | 1 (success) | 69490095 |
| 2 | play35-a | postKeyWraps (A) | `0xd8b1d088f4e69b869afa79cdfff4ece73fc4c80291f6d1961107cbb51b31fb5a` | 1 (success) | 69490098 |
| 2 | play35-b | registerKey (B) | `0x84fff94c1fc1ad8f231932f1b26d35894c2285ce119ee0f3b97754a08a02267e` | 1 (success) | 69490861 |
| 2 | play35-b | join (B) | `0x07f1788a4e8a6b6a870491a4e776c20391435f51b2c7b233abd4eacbe2ea0a28` | 1 (success) | 69491092 |
| 2 | play35-b | postKeyWraps (B) | `0x160c78eb9b403c03bbb392810d4934244e76277a047d5195a991b1e07da3a9af` | 1 (success) | 69491095 |
| 2 | web-C | registerKey (C) | `0x4609b888a789fe37ed04b0db24687ab027cb5039285c1b5a074a6d222a49cc05` | 1 (success) | 69491209 |
| 2 | web-C | join (C) | `0xc6e6368218364b3e385c52a66370048d818764524007f1710bea9363f16e7375` | 1 (success) | 69491261 |
| 2 | web-C | postKeyWraps (C) | `0x59e9add67348c415187564f06e5b90c3459075c7b49ef199ab3bc1666d36b903` | 1 (success) | 69491263 |
| 2 | play35-b | faucet (B test dollars) | `0x3469dc15bf689542293411dafc816a9f2a8bbf07440dd9614b3141b97d052ee2` | 1 (success) | 69492055 |
| 2 | play35-b | contribute (B adds $1.00) | `0xa9db624bc14e40eb85b95b4f15b936f46d90da30f1b52f0f2be97f93c90eaf45` | 1 (success) | 69492346 |
| 2 | web-C | faucet (C test dollars) | `0x2c16c0559c3aa88b0bba0129a39014c4d1f7180a15fc2f55747816b4bc3b6122` | 1 (success) | 69492441 |
| 2 | web-C | contribute (C adds $1.00) | `0x2db1f539e52875eabf247edf4dabeac6306d8e76ac97666464618aff02c7f2fe` | 1 (success) | 69492632 |
| 3 | play35-a | propose → executed (instant $0.10) | `0x5b7aeb500ee7ea3a42fc43c54452687a630fd1b6d9628eac2c5ea9238edb39f0` | 1 (success) | 69493037 |
| 3 | play35-b | propose → pending ($0.40) | `0x38fed6aea97e20c92341ff8439bdf55d9f7cf3452d6db609d11cb78ceec2abe2` | 1 (success) | 69493279 |
| 3 | play35-a | vote → executed (A approves) | `0x019fff3f46a5a87cb73b7ecae23936b9656fc034e169cb72fea218cec30fddd2` | 1 (success) | 69493450 |
| 3 | play35-a | send A→C $1.00 → ₹97 (round 6) | `0x9b1c255ce18f6e43f3129b378675e234faa2d442c3288aacfc1455e302244f87` | 1 (success) | 69493674 |
| 6 | web-C | contribute (C adds $0.01) | `0xfded533f5091624c54b6c8e11c492d20f63ae55648e6f7669ffa901db0084b92` | 1 (success) | 69494059 |
| 6 | play35-a | ack (A) | `0x8a88725d2e16d889b1bb30bdd221d398bb8ca817b4c918a4be26d51f113f3d5f` | 1 (success) | 69494330 |
| 6 | play35-b | ack (B) | `0xb585a02a65159195bd029915b9efb9496ac27d21cbc087e183499f4a72239e59` | 1 (success) | 69494574 |
| 6 | web-C | ack (C) | `0x065dd51be32a2525d535412a65865527016e5acfffebfa94ea1b044b620390fb` | 1 (success) | 69494683 |
| 6 | play35-b | settle (fxRoundId 6) | `0xca48d73b1ba611e6ae3c1a8feb6e76bc182fee2a2688311b4bbab35f80741f68` | 1 (success) | 69494976 |
| 7 | play35-a | payDebt (A $0.066668) | `0x0717d0b6365e88cc68cebfad83330810b4d65fade23a916601df98d9365d1c8f` | 1 (success) | 69495470 |
| 7 | play35-b | collect(B) via Collect it | `0xe9f09a4bb078ae97ae8c1f08a0f7c8f7f8f8d0de6afcdf5b04fdadffb1802049` | 1 (success) | 69495690 |
| 7 | play35-b | collect(C) via Send it to Asha | `0x5ab3e68917613e4cd005b1d0cacdf517e64a2e48077c37b0f153e2d3c30d8d6b` | 1 (success) | 69495752 |

## Files

- `s<step>-<nn>-<who>-<what>.png`: a = play35-a, b = play35-b, c = person C's browser, d = the linked
  browser. Phone captures are halved (540 × 1200) and all images reduced to 128 colours to keep the folder
  small. Android blacks out its passkey sheets in screenshots (`s1-02`, `s4-07`). The invite QR, the
  account e-mail and the device's place are blacked out.
- `s1-steps.tsv`, `s1-logcat-PLANS_TIMING.txt`: step 1 timing. `play35-a-logcat-PLANS_TIMING.txt`,
  `play35-b-logcat-PLANS_TIMING.txt`: every app mark (relay latency per transaction) from both phones.
- Not kept: the owner's Google screens other than `s2-05` (Chrome's first-run and the autofill prompt, which
  show the account name and e-mail).

Left running or changed on the machine: nothing of mine; emulators stopped (`emu kill`), headless Chrome
and logcat captures stopped. Both emulators keep Wi-Fi off from this run (`svc wifi enable` turns it back
on). Google Password Manager in the owner's account now also holds B's new Plans passkey (named "Plans").
