# Physical phone check

**One short pass on a real Android phone, near release.** It covers what an emulator can't prove. Use a phone that has never had Plans installed. Allow about 15 minutes. Write the result of each step (✅ / ❌ and a note) and send it to me.

**Before you start**
- Android 9 or newer. 14 or newer is best.
- Signed in to a Google account, with a screen lock (fingerprint preferred).
- Mobile data (not Wi-Fi) for steps 6 and 9, if you can.
- Write down: phone make and model, Android version, and the default passkey provider (Settings → Passwords & accounts, or Settings → Google → Autofill).

## Steps

1. **Install from the site.** On the phone, open https://plans.0xo.in/download and tap Download.
   - Note exactly what Android asks: "allow this source", and any Google Play Protect warning with its wording.
   - Install. ✅ if the app opens.
2. **Create an account.** Tap Create account.
   - ✅ if the sheet says *Create passkey for plans.0xo.in?* and your real fingerprint sensor works.
   - Note which password manager the sheet names. If it isn't Google Password Manager, that's the case we can't test on an emulator, so note what happens.
3. **Two keys, one prompt.** You → long-press the version number → Diagnostics → Run probe.
   - ✅ if it shows *first: yes, second: yes* after one fingerprint.
   - ❌ details: whether it asked twice, and any error text.
4. **Speed.** Note roughly how long it took from the fingerprint to the home screen in step 2, and from the fingerprint to "done" in step 3. Under 2 seconds is good.
5. **Join from a real link.** I'll send you an invite link in WhatsApp. Tap it.
   - ✅ if it opens in Plans (not the browser) and joining takes one fingerprint.
6. **Push notifications.** Lock the phone and leave it for 5 minutes. I'll request an approval from the demo plan.
   - ✅ if a notification arrives on the lock screen within 30 seconds.
   - Then turn on Battery saver, repeat, and note the delay.
7. **Scan a QR code with the camera.** Send tab → Scan code → scan the QR on my screen.
   - ✅ if it reads within 2 seconds in normal room light.
8. **Receipt photo.** Pay something small in the demo plan and attach a photo with the camera.
   - ✅ if the photo shows in the receipt and opens again after you close and reopen the app.
9. **Network timing.** On mobile data, send $0.05 to the demo member Asha.
   - Note the "Settled in" time on the receipt.
10. **Uninstall and restore.** Uninstall Plans, install it again from step 1, and tap I already use Plans.
    - ✅ if your account, plan and receipt photo all come back after one fingerprint.

## What to send me

The phone details, the ✅/❌ list, the Play Protect wording from step 1, the passkey provider from step 2, and the timings from steps 4, 6 and 9.
