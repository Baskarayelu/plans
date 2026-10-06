# Plans — Android app

Expo SDK 57 · React Native 0.86 · expo-router · TypeScript strict · Hermes. Android only.

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

## PRF probe (two-keys check)

You → long-press "About Plans" → Diagnostics → **Probe: existing passkey** (or **new passkey**).
The result shows whether `first` and `second` came back, their sha256 prefixes, the derived
address and key fingerprint, and the provider. It is also written to logcat:

```bash
adb -s emulator-5582 logcat -s PLANS_PRF
```
