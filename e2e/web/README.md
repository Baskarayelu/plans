# Plans web e2e

Drives the Plans web app (the same Expo code as the Android app, built for the browser and served at
`https://plans.0xo.in/app`) in headless Chrome, with Chrome's CDP virtual authenticator standing in for
the passkey. The testIDs are the Android app's (react-native-web renders `testID` as `data-testid`), so
the flows follow the Maestro flows in `app/e2e/*.yaml` step for step.

| Script | What it does |
|---|---|
| `smoke.mjs` | Loads one route, prints console errors, saves a screenshot. `node smoke.mjs [path=/app] [width] [theme] [out.png]` |
| `timing.mjs` | Taps and seconds from the landing page to a first confirmed transaction (test dollars, or joining the demo). `node timing.mjs [--path test-dollars\|demo\|both] [--runs N] [--width 1440\|390] [--live] [--json out.json]` |
| `flows.mjs` | The end-to-end flows against public testnet (below). PASS / FAIL / BLOCKED per flow, with tx hashes. |
| `shoot.mjs` | Design screenshots with fixture data (`lib/fixtures.mjs` answers the GraphQL queries), light and dark, 1440 and 390. |

`lib/browser.mjs` (launch, pages, request routing, local export, virtual passkey, tap/type helpers),
`lib/session.mjs` (create an account, unlock, client-side navigation), `lib/fixtures.mjs` (fixture
indexer for screenshots), `lib/flowkit.mjs` (actors, indexer watch, tx marks, results for `flows.mjs`).

## Setup

- Google Chrome at `/Applications/Google Chrome.app` (or set `CHROME_PATH`).
- `npm --prefix e2e/web install` (puppeteer-core only; it never downloads a browser).
- Build the web export first: `cd app && bash scripts/build-web.sh testnet <outDir>` (default outDir
  `site/public/app`; use `CLEAR=0` to keep Metro's cache on rebuilds). Point the scripts at it with
  `APP_DIR=<outDir>` or `--app-dir <outDir>`.

## Local export vs live

The app must run on the real origin `https://plans.0xo.in`:
- passkeys are bound to the rpId `plans.0xo.in`, so WebAuthn refuses any other origin (localhost included);
- the relayer only answers CORS requests from `https://plans.0xo.in`.

So the browser always asks for `https://plans.0xo.in/app/...`. In **local** mode (the default)
request interception answers every `/app` and `/app/*` request from the export directory (an SPA:
unknown paths get `index.html`), and everything else (relayer, Monad RPC, landing page) goes to the
real network. In **live** mode (`--live`, or `APP_DIR=""`) nothing is intercepted and the deployed
`/app` is used (at the time of writing it isn't deployed yet: `/app` answers 404).

## The virtual passkey

Each person gets their own CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`):
`protocol: ctap2` (2.1), `transport: internal` (a platform authenticator, like Touch ID / Android),
`hasResidentKey: true` (discoverable credentials, needed for "I already use Plans"),
`hasUserVerification: true` + `isUserVerified: true` (every ceremony passes UV, as a fingerprint would),
`hasPrf: true` (the WebAuthn PRF extension, which the app needs: PRF output 1 makes the account key,
output 2 the receipt keys), `automaticPresenceSimulation: true` (no touch needed).

What carries over and what doesn't (checked by the `receipt` flow):
- Same authenticator, site data cleared (`Storage.clearDataForOrigin`, all storage types): the
  credential survives, PRF gives the same outputs, so restore brings back the same address and key
  fingerprint (flow `restore`).
- Copying a credential to another context with `WebAuthn.getCredentials` → `WebAuthn.addCredential`
  (private key included) does NOT carry PRF. Chrome keeps the hmac-secret/PRF key per credential and
  the CDP `Credential` type has no field for it, so the imported copy signs but returns no PRF
  results, and the app shows `welcome-notice-prf-unavailable` ("this passkey can't make keys"). A
  second browser context therefore can't hold the same Plans account; a "second device with the same
  passkey" is emulated by clearing site data and restoring in the same context.
- Virtual authenticators live in memory only: accounts can't be kept between runs.

## flows.mjs

```
node flows.mjs [--only create,plan,...] [--width 390|1440] [--app-dir DIR | --live] [--json out.json]
```

390 × 844 (phone layout, mobile emulation) by default; `--width 1440` runs the laptop layout (rail
instead of tab bar). Every person is a separate browser context (own localStorage / IndexedDB /
cookies) with its own virtual authenticator. Output: one line per flow with PASS / FAIL / BLOCKED, the
transactions it confirmed (from the app's `PLANS_TIMING` `relay_ok` / `faucet_ok` marks, see
`app/src/lib/timing.ts`; collected from the console so they survive reloads), notes and screenshots.
Everything goes to `e2e/web/.runs/<timestamp>/results.json` (+ `<flow>-<person>.png` for every
person in a flow that didn't pass). `VERBOSE=1` prints steps and the app console, `HEADFUL=1` shows
the browser, `SHOTS=1` keeps end screenshots of passing flows too.

| Flow | Maestro | Steps |
|---|---|---|
| `create` | 01 | Create account (one passkey) → name/country → home with balance; registerKey tx; key fingerprint on the key screen matches the stored one |
| `test-dollars` | 03 (+ test dollars) | Add money → Get test dollars → faucet tx → home balance goes up |
| `plan` | — | New plan → name → rules (+ money in when funded) → Create plan (createPot, postKeyWraps) → invite screen → Copy link → plan home |
| `join` | 02 | second person opens the invite link → Join (one passkey + profile) → join tx → You're in! → plan |
| `claim` | 03 | funded person: Send → Send by link (claimCreate) → Copy link; new person opens it → create account and claim → claim tx |
| `spend` | 04 | Pay → member → $0.10, Food & drink, note → Goes through now → confirm → Paid + Settled in + Proof |
| `approval` | 05 | $0.40 → Needs 1 more approval → Ask for an OK (propose) → the member approves from Activity |
| `send` | 06 | B (GB, £) copies their Plans code; the funded person (US, $) opens it, sends 1 → Sent receipt with $ and £, Settled in, Proof; B's balance goes up (chain + B's home) |
| `dispute` | 07 | member opens the spend → Question this spend → Not part of the plan → send to the group (openDispute) → vote screen |
| `settle` | 08 | You → Try a settle-up → Start the demo (relayer makes the plan, the app joins it: join tx) → demo runs → End plan & settle up → Settle up → All settled |
| `collect` | — | `Pot.collect` has no UI path (`collect()` in `app/src/lib/chain/actions.ts` is never called from a screen): reported BLOCKED (no-ui) |
| `restore` | 09 | create account → note address + fingerprint → clear site data (CDP, keep the passkey) → I already use Plans → same address and fingerprint (stored, on the restored screen, on the key screen) |
| `receipt` | 10 | export/import the passkey into a second context (PRF check, above); then a spend with a note, read by the member after clearing their site data and restoring |

Links are opened the way a person opens them: a page load of `https://plans.0xo.in/app/j|c|p/…#secret`.
If the app doesn't take the link, the flow records an app bug and carries on through "Join with a
link or code" (paste → Open), so the rest still gets checked; the flow then reports FAIL with what
happened after the workaround.

Shared per run, because the relayer rations them per network (IP) per day: one faucet top-up
(`FAUCET_PER_IP_PER_DAY`, 3 by default, and one per account per day) on a "bank" person (US) that
funds the spend/send/claim flows, and one plan (`CREATE_POT_PER_IP_PER_DAY`, 30) made by the bank.
The demo is limited too (`DEMO_PER_IP_PER_DAY`, 10).

### Statuses

- **PASS**: every step ran and every check held.
- **FAIL**: an app (or harness) problem: error, screenshots and console tails in results.json. Flows
  that hit a known app bug and worked around it also end as FAIL (`bugs`, `after`).
- **BLOCKED (reason)**: stopped by something outside the app after doing every step that doesn't need it:
  - `indexer`: the Envio GraphQL endpoint doesn't answer (DNS, HTTP error or GraphQL errors seen by
    the page, or the start-of-run probe failed). Plan homes, invite previews, claim lookups, the demo
    plan, activity and profile rebuilds all read from it.
  - `faucet-limit`: the relayer's faucet said no (`FAUCET_LIMIT`, per network or per account per day).
  - `relayer-underfunded` / `relayer-down`: the relayer answered `RELAYER_UNDERFUNDED` (its gas lanes
    ran dry: `GET /v1/health` shows `lowBalance` per lane) or 502/503. Every relayed action stops.
  - `demo-limit`, `demo-disabled`, `no-ui`.

### The indexer

At the time of writing the relayer's `/v1/config` publishes `graphqlUrl: null` and the build default
`https://indexer.plans.0xo.in/v1/graphql` doesn't resolve, so the flows block where the app needs plan
data. Once an indexer is up, run with

```
PLANS_GRAPHQL_URL=https://<indexer>/v1/graphql node flows.mjs
```

and the relayer's `/v1/config` is answered with that URL inside the browser (the app takes the indexer
URL from it at start-up), so no rebuild is needed. The start-of-run probe says which URL is used and
whether it answers.

### Verified now vs blocked

Without the indexer: account creation + registerKey, the key fingerprint, test dollars (when the
network's faucet quota isn't used up), New plan → createPot + postKeyWraps → invite link, the demo start
(relayer makes the plan, the app's join tx), restore after clearing site data (same address and
fingerprint), the two-context send (Plans code → send tx → receipt with both currencies, recipient
balance from the chain), the money link (claimCreate) and the PRF carry-over check.

Needs the indexer: plan home, invite preview → join, claim lookup → claim, spends (04/05), the dispute,
the demo plan screen → settle, the profile rebuild on restore, and the second-device receipt.

## links.mjs (no testnet writes)

`node links.mjs [--app-dir DIR] [--width 390|1440]` checks, with fixtures and `noTestnetWrites()`:
every Plans link form (`/app/j|v/<pot>#s=`, `/app/join#pot=&s=`, `/app/c/1#k=`, `/app/claim#k=`,
`/app/p/<addr>#…`) reaches its screen with no "Unmatched Route" and no secret left in the address bar
or history; incomplete invites (zero, short or missing secret) show "stopped working"; pushState
navigation keeps the session; reloading a deep route goes through Unlock and back; and "Create account"
with a Plans passkey already in the browser restores that account (one passkey, same address).
`shoot.mjs` also uses `noTestnetWrites()`, so screenshots never spend testnet gas.
