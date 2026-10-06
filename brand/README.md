# Plans brand files

Every file here is generated from the approved design by `scripts/build.mjs`; nothing is drawn by hand. The design defines:

- **The mark:** the "wristband". Marigold stripes 0.27 units wide with 0.09 gaps, 1.2 × 0.55 units, corner radius 0.14 (`design/gen/app.css`, `.logo .lb`).
- **The wordmark:** "plans" in Bricolage Grotesque ExtraBold, tracking −0.02 em, set 0.45 em from the mark.
- **Colours:** pine `#10231B`, marigold `#F5B83D`, light ground `#F4F6F1`, dark ground `#0C1511`.

Text is converted to outlines, so the SVGs render the same everywhere.

Rebuild:

```sh
npm --prefix brand install
npm --prefix brand run build                 # SVG sources and every PNG
node brand/scripts/preview.mjs               # X profile preview
node brand/scripts/sheet.mjs                 # icon contact sheet
```

The PNG renders use headless Chrome through `site/node_modules/puppeteer-core`.

| File | Size | Use |
|---|---|---|
| `portal/plans-logo-1024.png` | 1024 × 1024 | Hackathon portal logo |
| `x/plans-x-profile-400.png` | 400 × 400 | X profile picture (mark inside the circle crop) |
| `x/plans-x-banner-1500x500.png` | 1500 × 500 | X banner (content in the centre-right safe area) |
| `logo/plans-logo-light.png`, `logo/plans-logo-dark.png` | 938 × 320, transparent | Lockup for light and dark grounds |
| `logo/plans-mark-light.png`, `logo/plans-mark-dark.png` | 600 × 275, transparent | Mark alone |
| `app/icon.png` | 1024 | Expo `icon` |
| `app/android-icon-foreground.png`, `-background.png`, `-monochrome.png` | 1024 | Android adaptive icon (mark inside the 66 dp safe zone) and themed icon |
| `app/splash-icon.png` | 1024, transparent | Splash on light and dark |
| `app/favicon.png` | 48 | Expo web favicon |
| `web/icon-192.png`, `web/icon-512.png`, `web/icon-maskable-512.png`, `web/apple-touch-icon.png`, `web/favicon-32.png`, `web/favicon-16.png`, `web/favicon.svg`, `web/site.webmanifest` | | PWA and site icons |
| `src/*.svg` | | SVG sources for all of the above |
| `preview/x-profile-preview.png`, `preview/icon-sheet.png` | | Review renders |

The banner's sentence is read from the one-line description in `docs/submission.md` at build time.
