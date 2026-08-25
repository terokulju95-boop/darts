const CACHE = 'darts-v21';

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

// ---- Cache helpers -------------------------------------------------------
// The Cache API only supports GET. Writing any other method throws
// "Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported",
// and if that promise is left floating it surfaces as an uncaught rejection.
// Both helpers below check the method themselves and swallow every error, so
// no cache operation can ever reject into the console.
function cacheable(req) {
  return req && req.method === 'GET';
}

function safePut(req, res) {
  if (!cacheable(req) || !res) return;
  if (res.status !== 200 && res.type !== 'opaque') return;
  let copy;
  try { copy = res.clone(); } catch (err) { return; }
  caches.open(CACHE)
    .then(c => c.put(req, copy))
    .catch(() => {});          // never leave this promise floating
}

function safeMatch(req) {
  if (!cacheable(req)) return Promise.resolve(undefined);
  return caches.match(req).catch(() => undefined);
}

function isRuntimeAsset(url) {
  return RUNTIME_HOSTS.indexOf(url.hostname) !== -1;
}

// Live Firestore/Auth traffic must never be served from cache.
function isLiveApi(url) {
  return /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com|firebaseinstallations\.googleapis\.com|firebaselogging|google-analytics\.com|googletagmanager\.com/.test(url.hostname);
}

self.addEventListener('fetch', e => {
  const req = e.request;

  // Anything that is not a plain GET is left entirely to the network.
  if (!cacheable(req)) return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Only http(s) — skip chrome-extension:, blob:, data: and friends.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Live API calls: network only. Firestore has its own offline layer.
  if (isLiveApi(url)) return;

  // 2. SDK and fonts: serve from cache, refresh in the background.
  //    This is the fix for being locked out of the app when offline.
  if (isRuntimeAsset(url)) {
    e.respondWith(
      safeMatch(req).then(cached => {
        const network = fetch(req).then(res => { safePut(req, res); return res; })
                                  .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3. HTML: network-first so a new deploy is picked up immediately.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(req)
        .then(res => { safePut(req, res); return res; })
        .catch(() => safeMatch(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // 4. Everything else (icons etc.): cache-first.
  e.respondWith(
    safeMatch(req).then(cached =>
      cached || fetch(req).then(res => { safePut(req, res); return res; })
                          .catch(() => cached)
    )
  );
});
