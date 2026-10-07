/*
 * Plans service worker (https://plans.0xo.in/app/sw.js, scope /app).
 * Its only job is notifications: show each push from the Plans relayer, and on a click bring
 * the Plans tab forward on the right screen (or open one). No fetch handler, no offline cache.
 *
 * Push bodies are Declarative Web Push JSON (relayer/src/webpush.ts):
 *   {"web_push": 8030, "notification": {"title", "body", "navigate", "lang"}, "tag"}
 * Safari 18.4+ shows those by itself without running this script; every other browser runs
 * the "push" handler below. Browsers require a visible notification for every push, so
 * anything unreadable still shows a generic one.
 */
"use strict";

var BASE = "/app";
var ICON = BASE + "/icons/icon-192.png";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/** Only this origin's /app routes; anything else opens the app's home. */
function safeUrl(u) {
  try {
    var url = new URL(u, self.location.origin);
    if (url.origin === self.location.origin && (url.pathname === BASE || url.pathname.indexOf(BASE + "/") === 0)) return url.href;
  } catch (e) {}
  return new URL(BASE, self.location.origin).href;
}

function readPush(data) {
  var msg = { title: "Plans", body: "Something changed in one of your plans.", url: BASE, tag: undefined, lang: "en-US" };
  if (!data) return msg;
  var j = null;
  try {
    j = data.json();
  } catch (e) {
    try {
      var t = data.text();
      if (t) msg.body = t.slice(0, 200);
    } catch (e2) {}
    return msg;
  }
  var n = j && j.web_push === 8030 && j.notification ? j.notification : j || {};
  if (typeof n.title === "string" && n.title) msg.title = n.title;
  if (typeof n.body === "string") msg.body = n.body;
  if (typeof n.lang === "string") msg.lang = n.lang;
  var nav = n.navigate || n.url || (j && j.url);
  if (typeof nav === "string") msg.url = nav;
  if (j && typeof j.tag === "string") msg.tag = j.tag;
  return msg;
}

self.addEventListener("push", function (event) {
  var msg = readPush(event.data);
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: ICON,
      badge: ICON,
      lang: msg.lang,
      tag: msg.tag,
      data: { url: safeUrl(msg.url) },
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = safeUrl((event.notification.data && event.notification.data.url) || BASE);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      var open = list.filter(function (c) {
        try {
          var p = new URL(c.url).pathname;
          return p === BASE || p.indexOf(BASE + "/") === 0;
        } catch (e) {
          return false;
        }
      });
      // Prefer the tab the person used last (focused, then visible).
      open.sort(function (a, b) {
        return (b.focused ? 2 : b.visibilityState === "visible" ? 1 : 0) - (a.focused ? 2 : a.visibilityState === "visible" ? 1 : 0);
      });
      var tab = open[0];
      if (tab) {
        // An open tab is already unlocked: move it in place (a reload would ask for the passkey again).
        tab.postMessage({ type: "plans:open", url: url });
        return tab.focus().catch(function () {
          return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
        });
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});

/*
 * The push service rotated the subscription. Subscribe again with the same key; the app sends
 * the new one to the relayer (with the account's proof) the next time it is unlocked.
 */
self.addEventListener("pushsubscriptionchange", function (event) {
  var old = event.oldSubscription;
  var key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(function () {}));
});
