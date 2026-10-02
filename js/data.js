/* LKG — course catalog + lazy reel loader.
   Manifest lists all 80 reels in Learning Path order; reel JSON is fetched on demand. */
(function () {
  const SS = window.SS;
  SS.reels = {};          // id -> reel data (loaded on demand)
  SS.catalog = null;      // { tracks, stages, reels:[{id,num,track,topic,file}] }
  const pending = {};     // id -> Promise

  SS.loadReel = function (id) {
    if (SS.reels[id]) return Promise.resolve(SS.reels[id]);
    if (pending[id]) return pending[id];
    const meta = SS.catalog.reels.find(r => r.id === id);
    if (!meta) return Promise.reject(new Error('unknown reel ' + id));
    pending[id] = fetch(meta.file)
      .then(r => { if (!r.ok) throw new Error('fetch ' + meta.file + ' -> ' + r.status); return r.json(); })
      .then(d => { SS.reels[id] = d; delete pending[id]; return d; })
      .catch(e => { delete pending[id]; throw e; });
    return pending[id];
  };

  SS.loadCatalog = function () {
    return fetch('data/manifest.json').then(r => r.json()).then(m => { SS.catalog = m; return m; });
  };
})();
