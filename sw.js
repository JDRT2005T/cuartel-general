// Cuartel General · service worker: permite instalar la app y abrirla aunque falle la conexión.
// La página se pide siempre a internet primero (así cada mejora llega sola); las librerías se guardan.
// Nunca guarda nada de Supabase, Wompi ni la IA: eso va siempre directo.
const CACHE = "cg-v1";
const BASE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./vendor/supabase.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Librerías e íconos: de la memoria si ya están (no cambian).
  if (url.pathname.includes("/vendor/") || url.pathname.includes("/icons/")) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Páginas: primero internet; si no hay conexión, la última versión guardada.
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "./index.html" : req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("./index.html"))));
  }
});
