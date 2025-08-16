// Simple "cache, falling back to network" + offline fallback for navigation
const CACHE = "pwa-prod-cache-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/assets/alarm.mp3",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => k !== CACHE && caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // For navigations, try cache, else network (so offline works)
  if (req.mode === "navigate") {
    e.respondWith(
      caches
        .match("/index.html")
        .then((r) => r || fetch(req).catch(() => caches.match("/index.html")))
    );
    return;
  }
  // Other requests: cache-first, then network
  e.respondWith(
    caches.match(req).then(
      (res) =>
        res ||
        fetch(req)
          .then((net) => {
            // Optionally cache new requests
            const copy = net.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {});
            return net;
          })
          .catch(() => res)
    )
  );
});
