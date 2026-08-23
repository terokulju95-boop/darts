const CACHE = 'darts-v4';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['./', './index.html', './manifest.webmanifest']).catch(()=>{}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if(e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if(url.includes('firebase')||url.includes('firestore')||url.includes('googleapis')) {
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
    return;
  }
  // Network first for HTML to always get latest
  if(url.endsWith('.html') || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if(res && res.status===200) {
          caches.open(CACHE).then(c=>c.put(e.request,res.clone()));
        }
        return res;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res&&res.status===200&&res.type!=='opaque') {
          caches.open(CACHE).then(c=>c.put(e.request,res.clone()));
        }
        return res;
      }).catch(()=>cached);
    })
  );
});
