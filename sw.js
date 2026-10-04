/* LKG service worker — app shell cache-first, reel JSON/audio cached at runtime */
const SHELL = 'lkg-shell-v14';
const SHELL_FILES = [
  '.', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'js/state.js', 'js/narrator.js', 'js/scenes.js', 'js/data.js', 'js/motion.js', 'js/audio.js', 'js/player.js', 'js/feed.js', 'js/main.js',
  'data/manifest.json'
];

/* cache-first for reel JSON + audio. Media elements (iOS Safari especially) send Range
   requests and need a 206 back, so serve slices of the cached full file. */
async function mediaResponse(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req.url);
  const range = req.headers.get('range');
  if (hit) {
    if (!range) return hit;
    const buf = await hit.arrayBuffer();
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return hit;
    const start = +m[1], end = Math.min(m[2] ? +m[2] : buf.byteLength - 1, buf.byteLength - 1);
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,
      'Content-Length': String(end - start + 1) } });
  }
  const res = await fetch(req);
  if (res.status === 200) cache.put(req.url, res.clone()).catch(() => {});
  return res;
}

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
    e.respondWith(mediaResponse(e.request));
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
