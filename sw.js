/* Painel de Bolso — service worker: abre sem internet com a última versão; online, sempre busca a mais nova. */
const CACHE = 'painel-v1.0';
const ASSETS = ['./', './index.html', './painel.js?v=1.0', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;
  const alvo = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(alvo, cp)); } return r; })
    .catch(() => caches.match(alvo).then(r => r || caches.match(req))));
});
