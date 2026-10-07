# Plans website (plans.0xo.in)

Next.js 16 (App Router) + Fumadocs, deployed on Vercel from this folder (`vercel.json`: `npm ci`, `npm run build`).

| Path | What |
|---|---|
| `/` | Landing page |
| `/download` | Android test build |
| `/docs` | Docs (Fumadocs, `content/docs`) |
| `/j/…`, `/c/…`, `/p/…` | Invite, claim and Plans-code fallback pages (App Links open the Android app instead) |
| `/v/<pot>`, `/s/<pot>` | Shared plan and public settle-up proof |
| `/stats` | Public numbers |
| **`/app`** | **The web app**: the same Expo codebase as the Android app (`../app`), built for the web |
| `/.well-known/assetlinks.json` | Android App Links / Credential Manager (must list both package names) |

## The web app at /app

`public/app/` is a static single-page export of `../app` (Expo SDK 57, expo-router, react-native-web).
It is **built locally and committed** — Vercel doesn't install or build the Expo app — so a site deploy
never depends on the app's native toolchain.

```bash
cd ../app
npm ci
bash scripts/build-web.sh testnet         # → ../site/public/app (CLEAR=1 to clear Metro's cache first)
cd ../site && npm run build               # checks the site with /app included
```

- `next.config.mjs` rewrites `/app` and every `/app/*` path that isn't a file (`/app/plan/0x…`,
  `/app/join#…`, `/app/claim#…`, `/app/v/<pot>#…`, `/app/link#…`) to `/app/index.html`, after public files,
  so `/app/_expo/…`, `/app/assets/…` and `/app/icons/…` are served as they are. The existing `/j`, `/c`, `/p`,
  `/v`, `/s` pages and `/.well-known/assetlinks.json` are unaffected.
- Headers for `/app`: `Referrer-Policy: no-referrer` (links carry secrets in `#`), `noindex`, HTML always
  revalidated, hashed bundles cached for a year, camera and passkeys allowed for this origin only.
- Network: the build is testnet (chain 10143) like the test APK; contract addresses come from
  `../contracts/deployments/10143.json` at build time, the relayer is
  `https://relayer-production-ecef.up.railway.app` (override with `PLANS_RELAYER_URL_TESTNET`), and the
  indexer URL comes from the relayer's `/v1/config` at runtime. `public/app/build.json` records what was built.
- Passkeys use rpId `plans.0xo.in`, so the web app only signs people in on this origin (and the relayer's
  CORS allows only `https://plans.0xo.in`). To try it locally, use the e2e harness (`../e2e/web`), which
  serves the export on the real origin through request interception.

`components/plans/WebAppButton.tsx` (`WEB_APP_LIVE`) controls the "Coming soon" tag on "Use Plans in your
browser" buttons; it is `true` now that `/app` serves the app.

## Screenshots

```bash
PLANS_FIXTURES=1 npm run build && PLANS_FIXTURES=1 npm start   # port 3000
node scripts/screenshots.mjs                                    # site pages, 1440 and 390, light and dark
node ../e2e/web/shoot.mjs                                       # web app screens → screenshots/app-*.png
```
