# Web notifications: what each browser allows

The Plans web app runs at https://plans.0xo.in/app. This page covers what it can do to notify people when its tab is closed, and what we built. Sources were checked on **7 Oct 2026** and are listed at the end. The Android app is unchanged and still uses Expo push.

## Per browser

"Closed" means no Plans tab is open. The mechanism is standard Web Push: a VAPID-signed message goes from the relayer to the browser's push service, and the service worker `/app/sw.js` shows it.

| Browser | Notifications with Plans closed? | Conditions | What the person sees |
|---|---|---|---|
| Chrome, Edge, Opera, Brave on Windows, macOS, Linux | **Yes, while the browser is running** (no window needed). Nothing arrives once the browser has fully quit [1][2]. | `userVisibleOnly: true`. The prompt appears after the tap. | The browser's prompt, then OS notifications that name the site. Chrome may show a quieter prompt (a bell in the address bar) to people who usually block prompts [5]. |
| Chrome, Edge, Samsung Internet on Android | **Yes, even with the browser app closed.** Android wakes it [1]. | Android 13+ also needs the browser app's own notification permission [3]. | A normal Android notification from the browser, labelled with the site. Since Chrome 155 the prompt doesn't block the page and can time out, leaving the permission at "default" [7]. |
| Firefox on desktop | **Yes, while Firefox is running** [2][9]. | The prompt only appears after a click or key press (Firefox 72+) [8]. | Firefox's prompt, then OS notifications. |
| Firefox on Android | The API is there [2]. We couldn't verify delivery while the app is closed. | Same as desktop. | A notification from Firefox. |
| Safari on macOS 13+ (Safari 16.1+) | **Yes**, from a normal tab with no install needed [11][2]. Web apps added with "Add to Dock" (Safari 17+, Sonoma) also get push [12]. | The request must come from a user gesture. Every push must show a notification [11][13]. | Safari's prompt, then macOS notifications. |
| Safari on iPhone and iPad, iOS/iPadOS **16.4+**, **Home Screen web app only** | **Yes**, once Plans is added to the Home Screen and opened from there [14]. | The manifest needs `display: standalone` (ours has it). Permission must be asked from a tap [14]. | The iOS prompt in the Home Screen app. Notifications look like any app's: Lock Screen, Notification Center and Apple Watch [14]. |
| Safari (or Chrome, Edge, Firefox) **in a normal tab** on iPhone or iPad | **No.** A tab has no `Notification` or `PushManager` API at all [2][15]. | — | We show "Add Plans to your Home Screen to get notifications" with the steps, and no button. |
| Chrome, Edge, Firefox on iOS, **added to the Home Screen** | **Yes**, same as Safari: the Home Screen app runs on WebKit whichever browser added it (iOS 16.4+) [14]. | Same as above. | Same as above. |
| iOS 18.4+ / macOS Safari 18.5+ | Same as above, plus **Declarative Web Push**: Safari shows a push with a JSON body (`"web_push": 8030`) itself, without running the service worker [16][17][18]. | Other browsers ignore the format and hand the same JSON to the service worker [18]. | Same notifications. Declarative messages aren't subject to the silent-push penalty [18]. |
| Any browser in a private or incognito window | No push in Chrome incognito (subscribing fails; we checked this in the browser test). We didn't check other browsers' private windows. | — | The screen says "That didn't work… Private windows can't get notifications." |

## Limits that apply to us

- **Every push must show a notification.**
  - Chrome rejects subscriptions without `userVisibleOnly: true`. If a push shows nothing, Chrome shows its own "This site has been updated in the background" [4][6].
  - Safari revokes the permission when pushes don't show a notification [13]. Apple doesn't say after how many.
  - Firefox allows 16 pushes per subscription that show nothing, and the count resets when the person visits the site [9][10].
  - Our service worker always shows one, including a generic "Plans" notification for a body it can't read.
- **No silent or background push on Safari** [13]. We don't need any.
- **Payload size**: push services must accept 4096 bytes. With aes128gcm encryption that leaves at most 3993 bytes of plaintext [19], and Apple returns 413 above 4 KB [13]. Ours is under 300 bytes.
- **Quotas and abuse rules**:
  - Since January 2026, Chrome rate-limits Web Push per site based on engagement and answers HTTP 429 [20].
  - Since October 2025, Chrome on desktop and Android removes the permission from low-engagement, high-volume sites. Installed web apps are exempt [21].
  - We only send what the Android app already gets: a few notifications per plan event.
- **Expired subscriptions**: a 404 or 410 from the push service means the subscription is gone, so the relayer deletes it [22][13]. Apple returns `BadJwtToken` if the VAPID `sub` claim isn't `mailto:` or `https:` [13]. Ours is `https://plans.0xo.in`.
- **The VAPID key pair is part of every subscription.** Changing it makes every browser subscribe again. The app does this on its next unlock for people who had notifications on.
- **iPhone Home Screen app storage**: it doesn't share Safari's storage, so people unlock with their passkey once in the Home Screen app. The steps on screen say so.
- **Desktop needs the browser running.** On a phone (Android, or an iPhone Home Screen app), notifications arrive with everything closed. The "on" text says which applies.

## What we built

- **`app/public/sw.js`**: the service worker, served at `/app/sw.js` with scope `/app`.
  - It shows a notification for every push: the title, the body, the Plans icon and a tag that collapses repeats.
  - On click, it focuses an open Plans tab and moves it to the right screen in place, with no reload, because a reload would ask for the passkey again. With no tab open, it opens one.
  - It has no fetch handler and no offline cache.
- **Registration**:
  - The service worker is registered on web only, and only on `plans.0xo.in`, `localhost` and `127.0.0.1` (`app/src/lib/state/webPush.web.ts`).
  - Registering never prompts. The prompt only comes from the **Turn on notifications** button on the notifications screen.
  - The button calls `pushManager.subscribe()` as its first action, so the browser still sees the tap (Safari and Firefox need this).
- **The notifications screen** (`app/src/app/notifications.tsx`) shows one of these states. The logic is in `webPushState.ts` and unit-tested.

| State | testID | What the screen shows |
|---|---|---|
| ask | `notifications-off` | Notifications are off; the button prompts |
| off | `notifications-off` | Permission granted but no subscription; the button subscribes without a prompt |
| on | `notifications-on` | Notifications are on; a **Turn off notifications** button (`btn-disable-notifications`) |
| blocked by browser | `notifications-blocked` | Points to the browser's site settings |
| iPhone/iPad tab | `notifications-install`, `notifications-install-steps` | Share → Add to Home Screen → open from the Home Screen |
| tab only | `notifications-tab` | No push here, or the relayer has no key; in-tab notifications only |
| not supported | `notifications-unsupported` | No notifications in this browser |

  Two more testIDs: when turning on fails, `notifications-error` explains why. The existing `btn-allow-notifications`, `notifications-status` and `screen-notifications` are kept.
- **Relayer** (`relayer/src/webpush.ts`, `relayer/src/routes/webpush.ts`; details in `relayer/README.md`):
  - `GET /v1/config` publishes `webPushPublicKey`.
  - `POST /v1/push/web` registers a subscription with the same EIP-191 proof as the Expo token. The signature covers the endpoint and keys and has a 24 h deadline.
  - `DELETE /v1/push/web` unregisters.
  - Subscriptions are stored in SQLite, at most 5 per account.
  - Endpoints are restricted to the browser push services, so the relayer can't be pointed at arbitrary URLs.
  - Every Expo notification is also sent to the account's browser subscriptions, with the same title and body plus the screen to open, in the Declarative Web Push format.
  - A 404 or 410 removes the subscription.
- **Manifest**: it already had `display: standalone`, `id`, `start_url`, `scope` and icons, which is what iOS needs.
  - `start_url` and `scope` stay **`/app`, not `/app/`**. The site 308-redirects `/app/` to `/app` (checked with `curl -I` on 7 Oct 2026), so `/app/` would make the installed app start outside its own scope.
  - For the same reason the service worker's scope is `/app`, which is wider than its folder. `site/next.config.mjs` therefore sends `Service-Worker-Allowed: /app` for `/app/sw.js`. Without that header the app falls back to the scope `/app/`.
- **Duplicates**: while push is on, the in-tab notification for a hidden tab is skipped, because the push covers it. The tab title count stays.

## What remains impossible

- No notification at all in a normal browser tab on iPhone or iPad, in any browser. Only the Home Screen app can get them, on iOS 16.4 or later.
- On desktop, nothing arrives while the browser is fully quit.
- No silent or background updates on Safari. Every push is a visible notification.
- Nothing in Chrome incognito windows. Other browsers' private windows weren't checked.
- After someone blocks notifications, we can't prompt again. Only the browser's site settings can undo it.
- A subscription that a browser drops by itself is renewed only when Plans is next unlocked in that browser, because the renewal needs the account's proof.

## Sources (all checked 7 Oct 2026)

1. web.dev, Push notifications FAQ: https://web.dev/articles/push-notifications-faq
2. caniuse, Push API (and its raw data): https://caniuse.com/push-api, https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/push-api.json
3. Android 13 notification runtime permission: https://developer.android.com/about/versions/13/changes/notification-permission
4. MDN, PushManager.subscribe(): https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
5. Chrome 84 quieter notification UI: https://developer.chrome.com/blog/new-in-chrome-84/
6. web.dev, Handling push messages: https://web.dev/articles/push-notifications-handling-messages
7. Chrome, notification prompts on Android: https://developer.chrome.com/blog/notification-prompts-android
8. Mozilla, restricting notification permission prompts (Firefox 72): https://blog.mozilla.org/futurereleases/2019/11/04/restricting-notification-permission-prompts-in-firefox/
9. MDN, Push API (quota): https://developer.mozilla.org/en-US/docs/Web/API/Push_API
10. Firefox default prefs (`dom.push.maxQuotaPerSubscription` = 16): https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/all.js
11. WebKit, Meet Web Push (Safari 16, macOS Ventura): https://webkit.org/blog/12945/meet-web-push/
12. WebKit, Safari 17.0 (web apps on Mac support web push): https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
13. Apple, Sending web push notifications in web apps and browsers: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
14. WebKit, Web Push for Web Apps on iOS and iPadOS (16.4): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
15. caniuse raw data, Notifications API (iOS: Home Screen only): https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/notifications.json
16. WebKit, Safari 18.4 (Declarative Web Push on iOS/iPadOS): https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
17. WebKit, Safari 18.5 (Declarative Web Push on macOS): https://webkit.org/blog/16923/webkit-features-in-safari-18-5/
18. WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
19. RFC 8291 (Message Encryption for Web Push): https://www.rfc-editor.org/rfc/rfc8291.txt
20. Chrome, Web Push rate limits: https://developer.chrome.com/blog/web-push-rate-limits
21. Google, automatic notification permission removal: https://blog.google/chromium/automatic-notification-permission/
22. web.dev, The Web Push Protocol: https://web.dev/articles/push-notifications-web-push-protocol

Not verified:
- How many ignored pushes Safari allows before revoking.
- Delivery on Firefox for Android while the app is closed.
- Edge's own quiet-prompt rules.
- Apple's restoration of EU Home Screen web apps in iOS 17.4, which we saw only in search summaries.
- Since iOS 26, any site added to the Home Screen opens as a web app by default (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). This doesn't change what we do.
