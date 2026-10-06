# Marketing clips

Silent, looping 1080 × 1350 clips for phone feeds. They contain real screens or real terminal output only.

| Clip | Source |
|---|---|
| `clips/day-07-intro.mp4` | The live landing page at phone size (dark), recorded with Chrome's screencast: `tools/record-site.mjs` |
| `clips/day-08-invariant-caught-bug.mp4` | Real run of `tools/day-08.sh` (invariant suite, the regression tests for the payee bug, full `forge test`) |
| `clips/day-09-gas-measured.mp4` | Real run of `tools/day-09.sh` (`contracts/tools/live-check.mjs`, `contracts/tools/ausd-relay-baseline.mjs` live on Monad mainnet) |
| `clips/day-10-no-crypto-words.mp4` | Real run of `tools/day-10.sh` on a scratch copy of the app: the copy check passes, then a crypto word makes the APK build refuse to start |

The terminal clips are recorded with `asciinema rec --headless --window-size 48x21` (the `tools/cast-*.cast` files). `tools/render-cast.mjs` replays the bytes through xterm.js; only the timing is compressed so each fits 8–15 s. Every clip ends with a cross-fade to its first frame, so it loops cleanly.

Re-render:

```sh
cd marketing/tools
asciinema rec --headless --window-size 48x21 --overwrite -c "bash day-08.sh" cast-day-08.cast
node render-cast.mjs cast-day-08.cast ../clips/day-08-invariant-caught-bug.mp4 "plans/contracts — forge test" 12
node record-site.mjs https://plans-0xo.vercel.app/ ../clips/day-07-intro.mp4
```
