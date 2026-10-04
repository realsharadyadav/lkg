/* LKG — course feed: one linear path of 80 reels (Learning Path order),
   stage dividers, lazy JSON loading, scroll-snap, gestures. */
(function () {
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const TRACK_ICON = { python: '🐍', genai: '🧠', agentic: '🤖' };

  function segsRow(order, currentId) {
    const segs = h('div', 'segs');
    order.forEach(item => {
      const seg = h('div', 'seg');
      if (item.id === currentId) seg.classList.add('cur');
      if (SS.state.isCompleted(item.id)) seg.classList.add('done');
      seg.appendChild(h('b'));
      segs.appendChild(seg);
    });
    return segs;
  }

  function chipText(data) {
    const total = SS.catalog.reels.length;
    const done = SS.state.completedCount(SS.catalog.reels.map(r => r.id));
    return `${TRACK_ICON[data.track] || '🎓'} ${data.track} · ${data.stage.replace(/^\d+\.\s*/, '')} · Reel ${data.num}/${total}`;
  }

  function buildReelEl(item, data, order) {
    const el = h('section', 'reel');
    el.dataset.section = data.track;
    const segRow = segsRow(order, item.id);
    const curSeg = [...segRow.children].find(s => s.classList.contains('cur'));
    el.appendChild(h('div', 'reel-bg'));
    if (SS.motion) SS.motion.attachBg(el);
    el.appendChild(h('div', 'reel-inner',
      `<div class="segs">${segRow.innerHTML}</div>` +
      `<div class="reel-meta cap-progress">${chipText(data)}</div>` +
      `<div class="stage"></div>` +
      `<div class="capzone">` +
      `<div class="cap-title">${data.topic}</div>` +
      `<div class="chap-chip"></div>` +
      `<div class="cap-text"></div>` +
      `<div class="cap-hint"><span class="arr">↑</span> swipe next · tap ⏯ · 2× tap ❤ · dots = chapters</div>` +
      `</div>` +
      `<div class="rail">` +
      `<button class="rail-btn rail-like" aria-label="Like"><span class="ic">❤️</span><span class="lb">0</span></button>` +
      (data.code ? `<button class="rail-btn rail-code" aria-label="Show code"><span class="ic">&lt;/&gt;</span><span class="lb">code</span></button>` : '') +
      (data.notes ? `<button class="rail-btn rail-notes" aria-label="Show notes"><span class="ic">📄</span><span class="lb">notes</span></button>` : '') +
      `<button class="rail-btn rail-mute" aria-label="Mute or unmute narration"><span class="ic">🔊</span><span class="lb">sound</span></button>` +
      `</div>`));
    const player = new SS.ReelPlayer(el, data, { segEl: [...el.querySelectorAll('.seg')].find(s => s.classList.contains('cur')) });
    const rail = el.querySelector('.rail');
    rail.addEventListener('pointerdown', e => e.stopPropagation());
    rail.addEventListener('click', e => e.stopPropagation());
    rail.querySelector('.rail-like').addEventListener('click', e => { const r = e.target.closest('.rail-btn').getBoundingClientRect(); player.like(r.left + r.width / 2, r.top + r.height / 2); });
    const codeBtn = rail.querySelector('.rail-code');
    if (codeBtn) codeBtn.addEventListener('click', () => SS.ui.openCode(data));
    const notesBtn = rail.querySelector('.rail-notes');
    if (notesBtn) notesBtn.addEventListener('click', () => SS.ui.openNotes(data));
    rail.querySelector('.rail-mute').addEventListener('click', () => {
      SS.narrator.setMuted(!SS.narrator.muted);
      document.dispatchEvent(new CustomEvent('ss:mute'));
      SS.ui.toast(SS.narrator.muted ? '🔇 Narration muted' : '🔊 Narration on');
    });
    player.hookEl.addEventListener('pointerdown', e => e.stopPropagation());
    attachGestures(el, player);
    return { el, player, id: data.id, data };
  }

  function buildTeaserEl(item, stageName) {
    const el = h('section', 'teaser');
    el.dataset.section = item.track;
    el.appendChild(h('div', 'reel-bg'));
    el.appendChild(h('div', 'teaser-card',
      `<span class="soon">🔒 Coming soon</span>` +
      `<h3>${TRACK_ICON[item.track] || '🎓'} Reel ${item.num} · ${item.topic}</h3>` +
      `<p>${stageName}</p>` +
      `<div class="count">This reel is being animated — check back after the next update</div>`));
    return el;
  }

  function buildWelcomeEl(done, total) {
    const el = h('section', 'teaser welcome');
    el.appendChild(h('div', 'reel-bg'));
    el.appendChild(h('div', 'teaser-card',
      `<span class="soon">👋 Welcome</span>` +
      `<h3>LKG</h3>` +
      `<p>Your path from <b>.NET architect</b> to <b>GenAI architect</b> — 80 chaptered reels, in exact learning order.</p>` +
      `<div class="mini-list">` +
      `<div>🎬 Every reel: animation + voiceover + captions</div>` +
      `<div>📚 Chapters inside each reel — jump with the dots</div>` +
      `<div>🧲 .NET analogies in Python · Architect's takes in GenAI</div>` +
      `<div>⚡ Recap + 3-question quiz so it sticks</div>` +
      `</div>` +
      `<div class="count">✅ ${done}/${total} reels complete — swipe up to continue</div>`));
    return el;
  }

  function buildStageDivider(stage, reels) {
    const el = h('div', 'stage-divider');
    const done = SS.state.completedCount(reels.map(r => r.id));
    el.appendChild(h('div', 'sd-card',
      `<span class="sd-kicker">STAGE ${stage.split('.')[0]}</span>` +
      `<h2>${stage.split('.').slice(1).join('.').trim()}</h2>` +
      `<div class="sd-meta">${reels.length} reels · ${done}/${reels.length} done</div>`));
    return el;
  }

  function attachGestures(el, player) {
    let down = null, lpTimer = null, lastTap = 0, swipeFired = false, toggled = false;
    el.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), long: false };
      swipeFired = false;
      lpTimer = setTimeout(() => { if (down) { down.long = true; player.pressStart(); } }, 500);
    });
    el.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if ((Math.abs(dx) > 12 || Math.abs(dy) > 12) && lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      if (!swipeFired && dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.6 && player.data.code) { swipeFired = true; SS.ui.openCode(player.data); }
    });
    const up = e => {
      if (!down) return;
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      if (down.long) { player.pressEnd(); down = null; return; }
      const dt = performance.now() - down.t;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (swipeFired || dist >= 14 || dt >= 400) return;
      // left / right edges step through scenes (Stories-style); centre pauses
      const box = el.getBoundingClientRect();
      const rx = (e.clientX - box.left) / box.width;
      if (rx < .22 || rx > .78) { lastTap = 0; player.seekScene(rx < .5 ? -1 : 1); return; }
      const now = performance.now();
      // react instantly (no double-tap wait); a second tap undoes the toggle and likes
      if (now - lastTap < 300) {
        lastTap = 0;
        if (toggled) player.tap();
        toggled = false;
        player.like(e.clientX, e.clientY);
      } else {
        lastTap = now;
        toggled = player.tap();
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = null; if (lpTimer) clearTimeout(lpTimer); player.pressEnd(); });
  }

  const items = [];       // parallel to catalog.reels: {meta, el, player, id}
  let feed = null;

  function refreshProgress() {
    const total = SS.catalog.reels.length;
    const done = SS.state.completedCount(SS.catalog.reels.map(r => r.id));
    const pill = document.getElementById('courseProgress');
    if (pill) pill.textContent = `✅ ${done}/${total}`;
    items.forEach(it => {
      if (!it.player || !it.data) return;
      const seg = it.el.querySelector('.seg.cur');
      if (seg) seg.classList.toggle('done', SS.state.isCompleted(it.id));
      const chip = it.el.querySelector('.cap-progress');
      if (chip) chip.textContent = chipText(it.data);
    });
    document.querySelectorAll('.stage-divider').forEach(d => {
      const reels = SS.catalog.stages.find(s => d.dataset.stage === s.name).reels;
      const meta = d.querySelector('.sd-meta');
      if (meta) meta.textContent = `${reels.length} reels · ${SS.state.completedCount(reels)}/${reels.length} done`;
    });
  }

  SS.feed = {
    init() {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      feed = h('div', 'feed active');
      feed.id = 'course';
      const total = SS.catalog.reels.length;
      const done = SS.state.completedCount(SS.catalog.reels.map(r => r.id));
      feed.appendChild(buildWelcomeEl(done, total));

      // stage dividers + placeholder items
      const stageOf = {};
      SS.catalog.stages.forEach(s => s.reels.forEach(id => stageOf[id] = s.name));
      const stageReels = {};
      SS.catalog.stages.forEach(s => stageReels[s.name] = s.reels.map(id => SS.catalog.reels.find(r => r.id === id)));
      let lastStage = null;
      SS.catalog.reels.forEach(meta => {
        const st = stageOf[meta.id] || '';
        if (st !== lastStage) {
          const stage = SS.catalog.stages.find(s => s.name === st);
          const d = buildStageDivider(st, stage.reels);
          d.dataset.stage = st;
          feed.appendChild(d);
          lastStage = st;
        }
        const el = buildTeaserEl(meta, st);
        feed.appendChild(el);
        items.push({ meta, el, player: null, id: meta.id, data: null, order: stageReels[st] || [meta] });
      });
      document.getElementById('feeds').appendChild(feed);

      // activation observer: start/stop players
      const activate = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (en.isIntersecting && en.intersectionRatio >= 0.6) {
            const prev = feed._active, next = en.target;
            if (prev === next) return;
            feed._active = next;
            const item = items.find(it => it.el === next);
            if (item && item.id) SS.state.setLastReel(item.id);
            items.forEach(it => {
              if (it.el === prev && it.player) it.player.stop();
              if (it.el === next && it.player) it.player.start();
            });
          }
        });
      }, { root: feed, threshold: [0.6] });
      const observeItem = it => activate.observe(it.el);
      items.forEach(observeItem);

      // lazy loader: fetch reel JSON before it scrolls into view
      const loader = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const it = items.find(x => x.el === en.target);
          if (!it || it.player) { loader.unobserve(en.target); return; }
          loader.unobserve(en.target);
          SS.loadReel(it.id).then(data => {
            const built = buildReelEl(it.meta, data, it.order);
            feed.replaceChild(built.el, it.el);
            it.el = built.el; it.player = built.player; it.data = data;
            observeItem(it);
            activate.unobserve(built.el); activate.observe(built.el);
          }).catch(() => { /* stays a teaser */ });
        });
      }, { root: feed, rootMargin: '500% 0px' });
      items.forEach(it => loader.observe(it.el));

      document.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); feed.scrollBy({ top: feed.clientHeight }); }
        else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); feed.scrollBy({ top: -feed.clientHeight }); }
        else if (e.key === ' ') { e.preventDefault(); this.activePlayer() && this.activePlayer().tap(); }
        else if (e.key === 'm') { SS.narrator.setMuted(!SS.narrator.muted); document.dispatchEvent(new CustomEvent('ss:mute')); }
      });

      document.addEventListener('ss:mute', () => items.forEach(it => it.player && it.player._syncRail()));
      document.addEventListener('ss:complete', () => refreshProgress());

      // resume where the user stopped
      const saved = SS.state.getLastReel();
      const it = saved ? items.find(x => x.id === saved) : null;
      if (it) requestAnimationFrame(() => { feed.scrollTop = it.el.offsetTop; });
      refreshProgress();
    },
    activePlayer() {
      if (!feed || !feed._active) return null;
      const found = items.find(it => it.el === feed._active);
      return found && found.player ? found.player : null;
    },
    next() { feed.scrollTo({ top: feed.scrollTop + feed.clientHeight, behavior: 'smooth' }); },
    goTo(id) { const it = items.find(x => x.id === id); if (it) feed.scrollTo({ top: it.el.offsetTop }); },
    nextLabel(id) {
      const rs = SS.catalog.reels, i = rs.findIndex(r => r.id === id);
      const n = i >= 0 ? rs[i + 1] : null;
      return n ? `Reel ${n.num} · ${n.topic}` : null;
    },
    kickActive() { const p = this.activePlayer(); if (p) p.kick(); },
    refreshProgress
  };
})();
