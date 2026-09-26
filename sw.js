/* Chạm HQ service worker.

   Strategy: network first for everything that can change, falling back to
   the cache when there is no signal. Only the icons are cache first, since
   they never change.

   This is deliberate. Cache-first on app.js and styles.css meant a phone
   that had once loaded the page kept showing that version for good, and no
   amount of reloading helped. Offline still works: every response is copied
   into the cache on the way past, and the cache answers when the network
   cannot. */
const CACHE = "cham-hq-v35";
const SHELL = [
  "./", "./index.html", "./styles.css?v=34", "./app.js?v=34",
  "./firebase-config.js?v=34", "./live.js?v=34", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ------------------------------------------------------------------ *
 * notifications
 *
 * Every push must show something - iPhones cut a site off from push if it
 * receives one and stays silent - so a message that fails to parse still
 * turns into a plain notification rather than nothing.
 * ------------------------------------------------------------------ */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Ch\u1ea1m HQ";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && "focus" in w) {
        if ("navigate" in w) w.navigate(target);
        return w.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

/* Browsers occasionally swap a subscription out from under us. Tell the
   page so it can save the new one next time it opens. */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((wins) =>
    wins.forEach((w) => w.postMessage({ type: "push-resubscribe" }))));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Never touch Firebase. Sign-in and the live task feed must always go
  // to the network, and caching them would freeze the page on stale data.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Icons never change, so serve them from the cache and save the round trip.
  if (url.pathname.includes("/icons/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Everything else: try the network, keep a copy, fall back to it offline.
  // GitHub Pages tells browsers to keep files for 10 minutes, so a plain
  // fetch can quietly come back with the old page. "no-cache" asks GitHub
  // whether it changed first - a tiny request when nothing has.
  const fresh = req.mode === "navigate"
    ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(req, { cache: "no-cache" });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
