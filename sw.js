const CACHE = 'darts-v5';

// App shell. The Firebase SDK and the web fonts live on other origins, so they
// are cached opportunistically on first successful load (see below) rather than
// precached here — one failure in addAll() would abort the whole install.
const SHELL = ['./', './index.html', './manifest.webmanifest'];

// Cross-origin assets the app cannot start without. These MUST end up in the
// cache, otherwise a cold offline start leaves `firebase` undefined.
const RUNTIME_HOSTS = [
  'www.gstatic.com',        // firebase-*-compat.js
  'fonts.googleapis.com',   // font stylesheet
  'fonts.gstatic.com',      // font files
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(err => console.warn('SW precache:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isRuntimeAsset(url) {
  return RUNTIME_HOSTS.indexOf(url.hostname) !== -1;
}

// Live Firestore/Auth traffic must never be served from cache.
function isLiveApi(url) {
  return /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com|firebaseinstallations\.googleapis\.com/.test(url.hostname);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1. Live API calls: network only. Firestore has its own offline layer.
  if (isLiveApi(url)) return;

  // 2. SDK and fonts: serve from cache, refresh in the background.
  //    This is the fix for being locked out of the app when offline.
  if (isRuntimeAsset(url)) {
    e.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3. HTML: network-first so a new deploy is picked up immediately.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // 4. Everything else (icons etc.): cache-first.
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached))
  );
});
