/* LKG service worker — app shell cache-first, reel JSON/audio cached at runtime */
const SHELL = 'lkg-shell-v4';
const SHELL_FILES = [
  '.', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'js/state.js', 'js/narrator.js', 'js/scenes.js', 'js/data.js', 'js/motion.js', 'js/audio.js', 'js/player.js', 'js/feed.js', 'js/main.js',
  'data/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // reel JSON + voiceover audio: cache-first, then network (and store for offline)
  if (url.pathname.includes('/data/reels/') || url.pathname.includes('/data/audio/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  // shell: cache-first with background refresh
  e.respondWith(caches.match(e.request).then(hit => {
    const fresh = fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
