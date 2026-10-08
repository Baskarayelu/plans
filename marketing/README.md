# Marketing clips

Silent, looping 1080 × 1350 clips for phone feeds. They contain real screens or real terminal output only.

| Clip | Source |
|---|---|
| `clips/day-07-intro.mp4` | The live landing page at phone size (dark), recorded with Chrome's screencast: `tools/record-site.mjs` |
| `clips/day-08-invariant-caught-bug.mp4` | Real run of `tools/day-08.sh` (invariant suite, the regression tests for the payee bug, full `forge test`) |
| `clips/day-09-gas-measured.mp4` | Real run of `tools/day-09.sh` (`contracts/tools/live-check.mjs`, `contracts/tools/ausd-relay-baseline.mjs` live on Monad mainnet) |
| `clips/day-10-no-crypto-words.mp4` | Real run of `tools/day-10.sh` on a scratch copy of the app: the copy check passes, then a crypto word makes the APK build refuse to start |
| `clips/day-11-web-app-live.mp4` | The live web app at /app (phone size, dark), Welcome → Create account → choice screen: `tools/record-app.mjs welcome` |
| `clips/day-12-link-a-browser.mp4` | The live web app, choice screen → Link this browser, step 1: `tools/record-app.mjs link` |
| `clips/day-13-cre-rounds-testnet.mp4` | Real run of `tools/day-13-cre.sh` (the two Chainlink CRE rounds on FxReference, Monad testnet) |
| `clips/day-14-browser-notifications.mp4` | Real run of `tools/day-14-notifications.sh` (relayer web push status, the app's service worker) |
| `clips/day-15-collect-after-settle.mp4` | Real run of `tools/day-15-collect.sh` (`collect` in the testnet Pot bytecode, its unit tests) |
| `clips/day-16-postdeploy-chrome-safari.mp4` | Real run of `tools/day-16-postdeploy.sh` (the recorded 7 Oct post-deploy check, the live build) |

The terminal clips are recorded with `asciinema rec --headless --window-size 48x21` (the `tools/cast-*.cast` files). `tools/render-cast.mjs` replays the bytes through xterm.js; only the timing is compressed so each fits 8–15 s. Every clip ends with a cross-fade to its first frame, so it loops cleanly.

The web app clips use `tools/record-app.mjs`: real taps on the live site, with an empty virtual passkey authenticator so no account is made. Board posts that use these clips, with their X character counts (`tools/xcount.mjs`), are in [`board/README.md`](board/README.md).

Re-render:

```sh
cd marketing/tools
asciinema rec --headless --window-size 48x21 --overwrite -c "bash day-08.sh" cast-day-08.cast
node render-cast.mjs cast-day-08.cast ../clips/day-08-invariant-caught-bug.mp4 "plans/contracts — forge test" 12
node record-site.mjs https://plans-0xo.vercel.app/ ../clips/day-07-intro.mp4
```
