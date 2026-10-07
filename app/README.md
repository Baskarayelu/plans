# Plans — Android app and web app

Expo SDK 57 · React Native 0.86 · expo-router · TypeScript strict · Hermes. One codebase, two
targets: the **Android app** (APK) and the **web app** at https://plans.0xo.in/app (Expo's web target,
react-native-web, a static single-page export; see "Web app" below).

The app is the Plans product described in `../docs/protocol.md`: a group money pot on Monad with
passkey accounts (Mera), live spends, onchain group rules and one-transaction settle-up, plus a
Send tab for cross-border sends and claim links. The approved design is
`../design/app-screens.html` (65 screens, light and dark).

## Build variants

| `APP_NETWORK` | App name | Package | Chain | Scheme |
|---|---|---|---|---|
| `testnet` (default) | Plans Test | `in.oxo.plans.test` | 10143 | `plans-test://` |
| `mainnet` | Plans | `in.oxo.plans` | 143 | `plans://` |

Both use passkey rpId `plans.0xo.in` and App Links `https://plans.0xo.in/j/*` (invites), `/c/*`
(claim links) and `/p/*` (Plans codes) with `autoVerify`. **assetlinks.json must list both
package names** with the release certificate's SHA-256, for both
`delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`.

Contract addresses come from `../contracts/deployments/<chainId>.json` when present (zero
placeholders otherwise). Endpoints default to the values in `app.config.ts` and can be overridden
at build time with env vars (`PLANS_RELAYER_URL[_TESTNET|_MAINNET]`, `PLANS_GRAPHQL_URL[...]`,
`PLANS_RPC_URL`, `PLANS_WS_URL`) or at runtime from the hidden Diagnostics screen.
`EXPO_PROJECT_ID` (an EAS project id) enables Expo push tokens; without it push registration is
skipped.

## Build an APK

```bash
npm ci                       # .npmrc sets legacy-peer-deps (see below)
npm run typecheck && npm test
bash scripts/build-apk.sh testnet debug     # → dist/plans-testnet-debug.apk
bash scripts/build-apk.sh testnet release   # → dist/plans-testnet-release.apk
bash scripts/build-apk.sh mainnet release   # → dist/plans-mainnet-release.apk
```

The script runs `expo prebuild --clean` (the `android/` folder is generated, never edited by
hand), then Gradle with `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and
`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, for `arm64-v8a` only
(`PLANS_ABIS` to change). **Debug and release are both signed with the Plans release keystore**:
`plugins/withPlansAndroid.js` adds a Gradle signing config that reads `PLANS_KEYSTORE_PATH` and
`PLANS_KEYSTORE_PASSWORD` (alias `plans`) from the environment; the script fills them from
`../../secrets/` if unset. No secret is written into the repository. The debug variant bundles
its JavaScript, so it runs without Metro.

### Dependency pins

- `@category-labs/mera` is pinned to exactly `0.2.0`. Its published peer dependency is
  `react-native-passkey@3.6.1`; the app uses `3.6.2` (what Mera's own repo uses, and the version
  whose Gradle file works with AGP 9 and normalises PRF `second` salts on Android). `package.json`
  `overrides` and `.npmrc` `legacy-peer-deps=true` accept that (the latter also skips an optional
  `react-dom` peer that Expo's devtools would otherwise pull in).
- `@noble/*` and `@scure/*` 2.4.0 (Hermes has no `crypto.subtle`; `expo-crypto` provides
  `crypto.getRandomValues`, see `src/polyfills.ts`).

## Web app (plans.0xo.in/app)

The same routes, screens and logic as the APK, built with Expo's web target and served by the site
from `../site/public/app`.

```bash
bash scripts/build-web.sh testnet            # → ../site/public/app (clears Metro's cache; CLEAR=0 to keep it)
bash scripts/build-web.sh testnet /tmp/web   # anywhere else
npm run web                                  # dev server (passkeys only work on plans.0xo.in, see below)
```

- `app.config.ts` adds `web` (output `single`, metro) and, only when `PLANS_WEB=1` (set by the script),
  `experiments.baseUrl: "/app"`, so Android deep links are unchanged. `public/index.html` is the page
  template (no-motion CSS, marigold focus rings, PWA tags) and `public/manifest.webmanifest` makes it
  installable (scope `/app`).
- `metro.config.js` gives the project its own Metro cache: for web, babel-preset-expo inlines the app
  config into expo-constants at transform time, and the shared OS-temp cache once served another
  project's config. The build script clears that cache and refuses a bundle without this app's config.
- Network flag like the APK (`testnet` default; `mainnet`). Contract addresses come from
  `../contracts/deployments/<chainId>.json` at build time; the relayer defaults to
  `https://relayer-production-ecef.up.railway.app` (`PLANS_RELAYER_URL_TESTNET`); the GraphQL URL comes
  from the relayer's `/v1/config` at runtime, as in the app; the live feed uses the same websocket
  (`wss://testnet-rpc.monad.xyz`).
- Passkeys are bound to rpId `plans.0xo.in` and the relayer allows only that origin, so the web app
  works on plans.0xo.in only. `../e2e/web` serves a local export on the real origin through request
  interception and answers passkey prompts with Chrome's virtual authenticator.

### Platform shims (`*.web.ts` next to the Android module, picked by Metro for web)

| Android | Web | File |
|---|---|---|
| react-native-passkey (Credential Manager) | `navigator.credentials`, Mera's browser client shape plus the second PRF salt: one ceremony, `eval {first: Mera's salt, second: sha256("plans.keys.v1")}` | `lib/identity/passkeyBridge(.web).ts` |
| expo-secure-store | localStorage, same keys and contents (account metadata, prefs, nonce allocator) | `lib/state/kv(.web).ts` |
| expo-file-system (encrypted cache, receipt ciphertext) | localStorage, base64url ciphertext (receipt blobs fall back to memory when full) | `lib/state/files(.web).ts` |
| expo-camera QR scanning | getUserMedia + jsQR, plus "Upload a photo" | `ui/camera(.web).tsx`, `lib/qr/decode.ts` |
| expo-image-picker / image-manipulator | their web implementations (file input, canvas) | — |
| react-native-view-shot + share sheet | html2canvas → PNG → Web Share API (files), else download + copy link | `lib/share/shareImage(.web).ts` |
| expo-haptics | no-op on desktops (vibrate where the browser has it) | — |
| Expo push | in-page live feed; browser Notification while the tab is hidden; "(2) Plans" title count. No web push | `lib/state/notify(.web).ts` |
| App Links `/j /c /p` | `/app/j/<pot>#s=…`, `/app/join#pot=…&s=…`, `/app/v/<pot>#s=…`, `/app/c/1#k=…`, `/app/claim#k=…`, `/app/p/<addr>#…`, `/app/link#c=…` (a link-this-browser QR, → `/app/add-browser`): parsed by an inline script in `public/index.html` before the router reads the address; the secret kept in memory (`window.__plansLink` → `pendingLink`), the history entry replaced with the route without it | `public/index.html`, `lib/domain/webLinks.ts`, `webEntry(.web).ts` |
| expo-brightness, intent launcher, PlansNative | guarded / not used on the web | — |

Nothing more is stored on the web than on Android: PRF outputs, the signing key, the X25519 secret and
the cache key stay in memory and are re-derived at every unlock.

### Layouts and breakpoints (design 101)

| Width | Layout |
|---|---|
| < 760 px | the approved phone screens 01–60 exactly (tab bar) — also every phone browser |
| 760–1023 px (tablets) | the phone layout at full width; detail panels open as sheets; sheets are centred dialogs |
| 1024–1439 px | 72 px icon rail · main · panel: form panels stay a 360 px column, detail panels cover the right of the main column (Esc closes), the live panel is hidden |
| ≥ 1440 px | 248 px rail · main · 400 px panel (designs 108–118) |

`ui/shell/responsive.ts` (`useLayout()`), `ui/shell/AppShell.tsx` (rail, panel, keyboard: N, S, G P/S/A/Y,
Esc), `ui/shell/panel.tsx` (`<SidePanel kind="live|form|detail">`), `ui/shell/desk.tsx`. "Confirm with
passkey" on computers and tablets, "Confirm with fingerprint" on phones (`useConfirmLabel()`). No
motion anywhere on the web (`ui/motion.ts`, plus CSS in `public/index.html`).

### Accounts across password managers

See "Identity and keys" below and `docs/crypto.md` §9: "Create account" on the web first asks the browser
for any existing Plans passkey (including "use a phone or tablet"); it never creates a second account
without the person choosing "I'm new to Plans". "Link this browser" brings an existing account to a
browser whose password manager can't use the phone's passkey.

### Timing

`lib/timing.ts` writes PLANS_TIMING marks (logcat on Android; console, `performance.mark` and
`window.__plansTiming` on the web). `../docs/first-tx-timing.md` defines the landing → first confirmed
transaction paths and `../e2e/web/timing.mjs` measures the web one.

### Sign-in on the web

- "Create account" asks the browser for any Plans passkey first (`lib/identity/webCreate.ts`); only "I'm
  new to Plans" creates one. Nothing answered → 166 (`ui/link/LinkChoice.tsx`): the phone's passkey through
  the browser's QR (167), "Link this browser" (`/link`, 168–170), or "I'm new". Phone browsers list "Link this
  browser" first. A phone's passkey that comes back without the keys output shows 176a ("Link with a code").
- "Add a browser" (`/add-browser`, 171–175) approves a new browser from any device with the account, the web
  app included; "Devices with your passkey" (`/devices`, the laptop You card, 178) lists them and removes a
  linked browser after a passkey confirmation. Other devices get an in-app notice on their next open
  (`ui/link/devices.tsx` `DeviceWatch`). See `docs/crypto.md` §9.8a.
- Reloading or opening a deep route with a stored account goes through Unlock and back (`WebGate` in
  `src/app/_layout.tsx`); with no account, through Welcome. A layout remount never locks an open session.

## Architecture

```
src/
  app/                 expo-router routes (one file per screen; see "Routes")
  lib/
    crypto/            bytes, keys (PRF → account, PRF → X25519/cache), seal (sealed box, group box,
                       meta/memo/profile/send-note formats), fingerprint (3 emoji)
    identity/          webauthnClient (dual-PRF Mera client), session (unlock/create/restore/lock),
                       probe (PRF diagnostics), flows (error routing)
    chain/             abi, eip712 (typed builders + hashes), nonces (248-bit prefix allocator),
                       actions (sign + relay every action), rpc (reads, previewSpend), live (WebSocket feed)
    api/               relayer (HTTP API, friendly errors), envio (GraphQL), http
    domain/            currency (formatting/FX maths), rules (presets, plain words), settlement
                       (min cash flow, settle/exit preview), links (App Links), groups (group keys,
                       profiles, contacts), planOps (create/join/spend/send flows)
    state/             data (TanStack Query hooks), effects (lock, live, re-wrap, push), storage
                       (SecureStore), cache (encrypted files), useAction, observable
  ui/                  kit (design components), layout (Screen, AppBar, Sheet), Text, Icon, Stub,
                       Keypad, Toast, pickers, money, plan/common
  theme/               tokens (light/dark from design/gen/app.css), ThemeProvider
modules/plans-native/  local Expo module: logcat lines (PLANS_PRF) and device/provider info
plugins/               config plugin for signing, ABIs and debug JS bundling
e2e/                   Maestro flows
docs/crypto.md         exact cryptographic constructions
```

### Conventions

- **Copy:** never show "wallet", "address", "gas", "token", "chain", "transaction",
  "blockchain", "crypto"; "sign" only in "Sign out" / "sign in to". "Digital dollars (AUSD)" only
  on screens 09, 43 and 45. Money is dollars first with the viewer's currency alongside
  (`useMoney()` / `useLocal()`). `npm run lint:copy` checks route files.
- **Proof:** receipts show a small "Proof" link to `https://monadvision.com/tx/<hash>` (testnet:
  `testnet.monadvision.com`) via `<Proof hash>`. "Settled in 0.6 s" is the relayer's measured
  submit→receipt latency (`settledMs(result)`).
- **Actions:** screens call `lib/domain/planOps.ts` or `lib/chain/actions.ts` through
  `useAction()`. Signing is silent once unlocked (one fingerprint per app launch).
- **Test ids:** every interactive element has a stable `testID` (buttons default to
  `btn-<label>`), used by the Maestro flows in `e2e/`.

## Identity and keys

See `docs/crypto.md`. In short: one passkey ceremony evaluates two PRF salts —
Mera's default (account) and `sha256("plans.keys.v1")` (keys). The account follows Mera's recipe
(PRF → BIP-39 → `m/44'/60'/0'/0/0`) into a Mera signing session and `toViemAccount`. The keys
output gives the X25519 identity and the cache key through HKDF. If the provider returns no
`second` output, "Unlock receipts" asks for the keys salt alone once per sign-in. Secrets live in
memory only; the session locks after 10 minutes in the background.

**Accounts across password managers.** A passkey's PRF outputs belong to that one credential, so a
new passkey in another password manager would be a different account. The web app never makes one
silently: "Create account" first asks for an existing Plans passkey (including "use a phone"), and
when that phone can't give PRF over the browser (`prf-unavailable`) the browser is **linked**
instead. It creates its own passkey, shows a QR and a code with three emoji, and the phone (one
fingerprint, after checking the emoji) sends the account key end to end encrypted through the
relayer. The browser keeps it in an encrypted vault on the relayer that only its own passkey opens,
so later unlocks there, and in any browser where that passkey syncs, open the same account. See
`docs/crypto.md` §9 (`src/lib/link/*`).

## PRF probe (two-keys check)

You → long-press "About Plans" → Diagnostics → **Probe: existing passkey** (or **new passkey**).
The result shows whether `first` and `second` came back, their sha256 prefixes, the derived
address and key fingerprint, and the provider. It is also written to logcat:

```bash
adb -s emulator-5582 logcat -s PLANS_PRF
```
