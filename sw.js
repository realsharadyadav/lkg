/* LKG service worker — app shell cache-first, reel JSON/audio cached at runtime */
const SHELL = 'lkg-shell-v40';
const SHELL_FILES = [
  '.', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'img/icon.svg',
  'js/icons.js', 'js/state.js', 'js/narrator.js', 'js/scenes.js', 'js/data.js', 'js/motion.js', 'js/audio.js', 'js/player.js', 'js/feed.js', 'js/main.js',
  'data/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // reel JSON + voiceover audio: cache-first, then network (and store for offline)
  // voiceover audio goes straight to the network: media elements (iOS Safari especially)
  // use Range requests, which a service worker must not intercept
  if (url.pathname.includes('/data/audio/')) return;
  if (url.pathname.includes('/data/reels/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.status === 200) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  // shell: network-first so a deploy shows up on the next load; cache only when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
