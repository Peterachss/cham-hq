/* Chạm HQ service worker.

   Strategy: network first for everything that can change, falling back to
   the cache when there is no signal. Only the icons are cache first, since
   they never change.

   This is deliberate. Cache-first on app.js and styles.css meant a phone
   that had once loaded the page kept showing that version for good, and no
   amount of reloading helped. Offline still works: every response is copied
   into the cache on the way past, and the cache answers when the network
   cannot. */
const CACHE = "cham-hq-v7";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./firebase-config.js", "./live.js", "./manifest.webmanifest",
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
  e.respondWith(
    fetch(req)
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
