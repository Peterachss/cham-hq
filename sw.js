/* Chạm HQ service worker.
   Bump CACHE when you change styles.css, app.js or index.html. */
const CACHE = "cham-hq-v4";
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
  if (new URL(req.url).origin !== self.location.origin) return;

  // Content and settings always try the network first, so a change shows up
  // straight away instead of being frozen in the cache.
  const path = new URL(req.url).pathname;
  if (path.endsWith("data.json") || path.endsWith("firebase-config.js")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // everything else: cache first, so it opens with no signal
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
