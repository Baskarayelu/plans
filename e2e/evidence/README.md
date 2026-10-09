# Evidence

Screenshots and results kept as proof of what was checked, by date and area. Nothing here shows a
real person's account or email.

- `postdeploy/<run>/`: every post-deploy check against https://plans.0xo.in (scripts/deploy-site.sh →
  e2e/web/postdeploy.mjs): one PNG per page × browser × width × theme, plus `results.json`.
- `2026-10-08-receipt-rates/`: Group 2 "rates on every receipt" (fixture data, e2e/web/shoot.mjs),
  1440 and 390, light and dark.
- `2026-10-09-rates-followups/`: Group 2 follow-ups (fixture data, e2e/web/shoot.mjs), 1440 and 390,
  light and dark. `*-stale`: every rate 7 hours old (fixtures `staleFx`), so Check and send, settle-up,
  leave and "I paid for something" in pounds are blocked with "Rates are out of date. Try again in a
  minute." and a Refresh rates button. `send-amount`, `send-confirm`, `leave`, `settle`, `settle-rates`:
  the previews with the receipts' own rate lines (same round-or-quote choice). `summary`: the settled
  summary at 390 with its spend list answered (no "Couldn't load every spend").
- `2026-10-09-trip-templates/`: Group 2 "trip templates" (fixture data, e2e/web/shoot.mjs), 1440 and
  390, light and dark. `new-plan`: New plan with the "Start from" row (Blank chosen). `new-plan-template`:
  Ski week chosen (name, emoji, colour, next Saturday to Saturday, Balanced). `new-plan-budgets`: people
  going raised to 7 and the suggested budgets rescaled. `plan-rules-template`: step 2 with the budgets card
  (and, on a laptop, budgets and "Started from" in the preview panel). `customise-budgets`: Change budgets
  opens Customise rules with the template's budgets filled in.
- `2026-10-09-stage-b/`: Stage B on public Monad testnet: two Android emulators with the Plans Test APK
  built from `5fe3a7f` and the live web app, one plan from invite to settle-up (fxRoundId 6), debt
  payment and `collect`, link a browser by a camera scan, restore, and the Android first-transaction
  timing. `RUN.md` has every step, result, transaction and bug. Test accounts only; the Google account
  e-mail is blacked out.
