# Landing page → first confirmed transaction: taps and seconds

How many taps and seconds it takes a new person to get from https://plans.0xo.in to a confirmed
transaction on Monad, on the two ways in: the **web app** (plans.0xo.in/app, in a browser) and the
**Android app** (installed from the APK).

## The paths

"First confirmed transaction" is the first transaction the person asks for, confirmed on Monad
testnet (receipt from the relayer). Two variants are measured on each path:

| Variant | From home | Transaction |
|---|---|---|
| **Test dollars** | Add money → Get test dollars → Get $25 test dollars | the faucet sends $25 (relayer `POST /v1/faucet`) |
| **Try a settle-up** | Start demo (Home card, or You → Try a settle-up) → Start the demo | the person's own signed `join` of the demo plan, relayed |

Right after sign-up the app also registers the person's key (`registerKey`, relayed in the
background, no tap). It is reported separately as the first confirmed transaction overall.

### Web path (browser)

| # | Tap | Screen after |
|---|---|---|
| 1 | "Use Plans in your browser" on the landing page | Welcome (102) |
| 2 | Create account | the browser's passkey dialog: an existing Plans passkey, or none |
| (3) | "I'm new to Plans" on the choice screen (166, once approved; until then "Make a new account") | the browser's create dialog → fingerprint / face / screen lock |
| 3–4 | the name field, type the name, Continue | Home |
| +3 | Add money → Get test dollars → Get $25 test dollars | confirmed: "+$25.00" |
| or +2/3 | Start demo → Start the demo | confirmed: joined the demo plan |

### Android path (APK)

| # | Tap | Screen after |
|---|---|---|
| 1 | "Get the Android app" on the landing page (phone browser) | /download |
| 2 | Download "Plans Test" | browser download prompt |
| 3 | Download / Open (browser) | Android installer |
| (4–5) | First time only: Settings → "Allow from this source", back | installer |
| 6 | Install | installed |
| 7 | Open | Welcome (01) |
| 8 | Create account | Google Password Manager sheet |
| 9 | Continue (+ fingerprint or PIN) | Profile (03) |
| 10–11 | the name field, type the name, Continue | Home |
| +3 | Add money → Get test dollars → Get $25 test dollars | confirmed |

## Measured: web (automatic)

`e2e/web/timing.mjs` runs the web path end to end in headless Chrome against the live landing page,
the real relayer and Monad testnet, with Chrome's CDP virtual authenticator (ctap2, internal, resident
key, user verification, PRF) answering the passkey prompts instantly:

```bash
npm --prefix e2e/web install
bash app/scripts/build-web.sh testnet                  # local export → site/public/app
node e2e/web/timing.mjs --path both --runs 3 --json timing.json
node e2e/web/timing.mjs --path both --live             # against the deployed plans.0xo.in/app
node e2e/web/timing.mjs --path both --width 390        # phone-browser layout
```

Results on 7 Oct 2026 (laptop layout, 1440 px, local export on the real origin, Monad testnet; the
build before the "Create account" choice screen, so the choice tap isn't included yet — add 1 tap):

| Path | Taps | Keystrokes | Seconds | Transaction |
|---|---|---|---|---|
| Test dollars | 7 | 4 (the name) | 2.4 | faucet `0xa350cdb1…8b67a5` |
| Try a settle-up | 7 | 4 | 7.5 | `join` `0x3af9f10b…7d91b35` |
| (background key registration) | 0 extra | — | 3.7 | `registerKey` `0x8e3f697e…b0eb67` |

These are machine times: a person adds reading time and the passkey gesture (about 1–2 s per prompt;
there is one passkey prompt on this path). The step-by-step times are in the JSON (`steps`) and the
app's own marks (`marks`).

### Live, 8 Oct 2026 (deployed plans.0xo.in/app, with the 166 choice screen)

`node e2e/web/timing.mjs --path test-dollars --live --width <w>`, Monad testnet, virtual passkey:

| Layout | Taps | Keystrokes | Seconds | Transaction |
|---|---|---|---|---|
| Laptop, 1440 px | 8 | 4 | 6.05 | faucet `0x635c5408…c851b96a` |
| Phone browser, 390 px | 8 | 4 | 7.03 | faucet `0x7030d1ef…7851f179` |

Steps (1440): landing loaded 0.41 s · Welcome 0.81 s (1 tap) · passkey created 4.98 s (3 taps: Create
account, I'm new to Plans) · Home 5.07 s (5 taps) · confirmed 6.04 s (8 taps). The extra tap against
7 Oct is "I'm new to Plans"; the ~4 s before the passkey is created is the browser's search for an
existing Plans passkey plus the create ceremony. A person adds the passkey gesture (about 1–2 s) and
reading time. The Android path is re-measured on the emulators in Stage B.

## Measuring the Android path

No emulator automation is used for this number. With a phone (or emulator) and a stopwatch:

1. `adb logcat -c && adb logcat -s PLANS_TIMING PLANS_PRF` on the computer.
2. Start the stopwatch when the landing page has loaded in the phone's browser; count every tap in the
   table above (the "allow from this source" taps appear only the first time on a phone).
3. The app writes one JSON line per mark under the `PLANS_TIMING` tag: `app_boot`, `app_ready`,
   `route:/welcome`, `route:/profile`, `route:/` (home), `relay_ok` (with `action` and `txHash`),
   `faucet_ok`, `tx_first`. Install time is the stopwatch time at `app_boot` minus the time of tap 1.
4. Stop at `faucet_ok` (test dollars) or `relay_ok` with `"action":"join"` (Try a settle-up).

The marks come from `app/src/lib/timing.ts` (Android: logcat; web: console, `performance.mark` and
`window.__plansTiming`), so both paths are measured with the same events.
