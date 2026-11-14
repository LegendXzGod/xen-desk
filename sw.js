/* sw.js - caches the app shell only, network-first. Never touches data: cross-origin
   requests (R2) and anything that is not a shell file pass straight through, so numbers are never stale. */
const CACHE = "xen-desk-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json", "icons/icon-192.png"];
const SHELL_FILES = new Set(SHELL.filter(f => f !== "./").map(f => "/" + f));
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== "GET") return;
  const scope = new URL(self.registration.scope).pathname;            // e.g. /xen-desk/
  const rel = "/" + u.pathname.slice(scope.length);
  const isShell = e.request.mode === "navigate" || SHELL_FILES.has(rel);
  if (!isShell) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});
