/* LKG — boot, sheets, syntax highlight, notes renderer, FX, settings, PWA */
(function () {
  const SS = window.SS;
  const $ = s => document.querySelector(s);
  SS.audioUnlocked = false;

  /* ---------------- share ---------------- */
  async function shareReel(data) {
    const url = 'https://lkgschool.in/?reel=' + encodeURIComponent(data.id);
    const payload = { title: data.topic + ' — LKG School', text: data.topic + ' — a 1-minute animated reel on LKG School (free GenAI course for .NET devs)', url };
    try {
      if (navigator.share) { await navigator.share(payload); return; }
      await navigator.clipboard.writeText(url);
      toast('🔗 Link copied');
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user closed the share sheet
      toast(url);
    }
  }

  /* ---------------- analytics (Cloudflare Web Analytics, cookieless) ---------------- */
  const CF_BEACON_TOKEN = '43403f5627e94125a22ecd705208684c';   // paste the token from Cloudflare dashboard → Web Analytics; empty = off
  if (CF_BEACON_TOKEN && location.hostname !== 'localhost') {
    const s = document.createElement('script');
    s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
    document.head.appendChild(s);
  }

  /* ---------------- toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------------- sheets ---------------- */
  const scrim = $('#scrim');
  const sheets = { code: $('#codePanel'), notes: $('#notesSheet'), settings: $('#settingsSheet'), about: $('#aboutSheet'), script: $('#scriptSheet'), map: $('#mapSheet') };
  let openName = null, onSheetClose = null;
  function fireClose() { const f = onSheetClose; onSheetClose = null; if (f) f(); }
  /* ---- side panels (code ← right, notes → left) are pages, not popups:
         they track the finger and the reel slides aside, iOS-navigation style ---- */
  const SIDE = { code: 1, notes: -1 };          // +1 = lives to the right, -1 = to the left
  const feedsEl = $('#feeds'), topEl = $('#topbar');
  const appW = () => $('#app').clientWidth || innerWidth;
  let settleTimer = 0;
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  function setSide(name, p, dur) {             // p: 0 = closed … 1 = open; dur in s (0 = follow the finger)
    p = Math.max(0, Math.min(1, p));
    const dir = SIDE[name], el = sheets[name];
    const tr = dur ? `transform ${dur}s ${EASE}, opacity ${dur}s ${EASE}, border-radius ${dur}s ${EASE}` : 'none';
    el.style.transition = feedsEl.style.transition = topEl.style.transition = scrim.style.transition = tr;
    el.style.transform = `translateX(${dir * (1 - p) * 100}%)`;
    // the reel recedes: slides aside, shrinks a touch and rounds its corners (depth, like iOS)
    const back = p ? `translateX(${-dir * p * 30}%) scale(${1 - p * 0.06})` : '';
    feedsEl.style.transform = topEl.style.transform = back;
    feedsEl.style.borderRadius = p ? (p * 28) + 'px' : '';
    scrim.style.opacity = String(p * 0.3);
    el.style.visibility = 'visible';
  }
  // flick speed (px/ms) shortens the settle: a fast swipe lands fast, a slow drag eases in
  const durFor = v => Math.max(0.26, Math.min(0.5, 0.5 - Math.abs(v || 0) * 0.12));
  function settleSide(name, open, v) {
    clearTimeout(settleTimer);
    setSide(name, open ? 1 : 0, durFor(v));
    if (!open) settleTimer = setTimeout(() => {     // fully closed: drop the transforms
      feedsEl.style.transform = topEl.style.transform = feedsEl.style.borderRadius = ''; scrim.style.opacity = '';
      sheets[name].style.visibility = '';
    }, 520);
  }
  function openSheet(name) {
    fireClose();
    if (openName && SIDE[openName] && openName !== name) settleSide(openName, false);
    Object.values(sheets).forEach(s => s.classList.remove('open'));
    sheets[name].classList.add('open'); scrim.classList.add('on'); openName = name;
    if (SIDE[name]) {
      // opened by a button: content glides in a beat after the page
      sheets[name].classList.remove('glide'); void sheets[name].offsetWidth; sheets[name].classList.add('glide');
      settleSide(name, true);
    }
  }
  function closeSheets(v) {
    if (openName && SIDE[openName]) settleSide(openName, false, typeof v === 'number' ? v : 0);
    Object.values(sheets).forEach(s => s.classList.remove('open')); scrim.classList.remove('on'); openName = null; fireClose();
  }
  scrim.addEventListener('click', () => closeSheets());

  /* Horizontal swipe tracker. Uses touch events on phones so it can claim the gesture
     (preventDefault) the moment it turns sideways; otherwise the browser grabs it as a
     scroll and cancels the swipe — the "had to swipe twice" bug. Mouse uses pointer events. */
  function hswipe(el, o) {
    let s = null;
    const begin = (x, y, target) => { s = o.canStart(target) ? { x, y, lx: x, lt: performance.now(), v: 0, name: null, dead: false } : null; };
    const track = (x, y) => {                       // returns true while we own the gesture
      if (!s || s.dead) return false;
      const dx = x - s.x, dy = y - s.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (!s.name) {
        if (ax < 8 && ay < 8) return ax > ay && ax > 2;          // still deciding: hold off scrolling if it leans sideways
        if (ax > ay * 1.1) { s.name = o.decide(dx); if (!s.name) { s.dead = true; return false; } }
        else { s.dead = true; return false; }
      }
      const now = performance.now(), dt = now - s.lt;
      if (dt > 0) { s.v = 0.7 * ((x - s.lx) / dt) + 0.3 * s.v; s.lx = x; s.lt = now; }
      o.move(s.name, dx);
      return true;
    };
    const finish = x => {
      if (s && s.name) o.end(s.name, x - s.x, performance.now() - s.lt > 120 ? 0 : s.v);
      s = null;
    };
    el.addEventListener('touchstart', e => { if (e.touches.length !== 1) { s = null; return; } const t = e.touches[0]; begin(t.clientX, t.clientY, e.target); }, { passive: true });
    el.addEventListener('touchmove', e => { if (!s) return; const t = e.touches[0]; if (track(t.clientX, t.clientY) && e.cancelable) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', e => finish(e.changedTouches[0].clientX));
    el.addEventListener('touchcancel', () => { if (s && s.name) o.end(s.name, 0, 0); s = null; });
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') begin(e.clientX, e.clientY, e.target); });
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && s) track(e.clientX, e.clientY); });
    el.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') finish(e.clientX); });
  }

  /* reel → page: used by feed.js for every reel */
  function bindReelSwipe(reelEl, player) {
    const dirOf = n => n === 'code' ? -1 : 1;
    hswipe(reelEl, {
      canStart: t => !openName && !t.closest('.aud-hit, .chapbar, .quiz, .nextup, .done-pop'),
      decide: dx => {
        const n = dx < 0 ? 'code' : 'notes';
        if (!player.data[n]) return null;
        if (n === 'code') SS.ui.fillCode(player.data); else SS.ui.fillNotes(player.data);
        clearTimeout(settleTimer);
        sheets[n].classList.remove('glide');
        return n;
      },
      move: (n, dx) => setSide(n, Math.max(0, dx * dirOf(n)) / appW(), 0),
      end: (n, dx, v) => {
        const p = Math.max(0, dx * dirOf(n)) / appW(), flick = v * dirOf(n);
        if (p > 0.25 || flick > 0.3) {   // forgiving: a quarter of the way, or a light flick
          Object.values(sheets).forEach(s => s.classList.remove('open'));
          sheets[n].classList.add('open'); scrim.classList.add('on'); openName = n;
          settleSide(n, true, v);   // narration keeps playing while reading code / notes
          try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
        } else settleSide(n, false, v);
      }
    });
  }
  // page → back to the reel: drag it the way it came
  Object.keys(SIDE).forEach(name => {
    const dir = SIDE[name];
    hswipe(sheets[name], {
      canStart: t => openName === name && !t.closest('pre, table, select, input'),
      decide: dx => dx * dir > 0 ? name : null,
      move: (n, dx) => setSide(n, 1 - Math.max(0, dx * dir) / appW(), 0),
      end: (n, dx, v) => { if ((dx * dir) / appW() > 0.25 || v * dir > 0.3) closeSheets(v); else settleSide(n, true, v); }
    });
  });
  // one-time hint about the side swipes
  try {
    if (!localStorage.getItem('lkg_swipe_hint')) {
      setTimeout(() => { toast('← swipe for code · swipe → for notes'); localStorage.setItem('lkg_swipe_hint', '1'); }, 9000);
    }
  } catch (e) {}
  document.querySelectorAll('.close-sheet').forEach(b => b.addEventListener('click', closeSheets));

  /* ---------------- python highlighting ---------------- */
  function py(code) {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(#[^\n]*)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(import|from|def|return|if|else|elif|while|for|in|not|and|or|is|None|True|False|class|with|as|try|except|finally|lambda|pass|raise|await|async|yield|global|print)\b|(@[\w.]+)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*)(?=\()/g;
    return esc.replace(re, (m, com, str, kw, dec, num, fn) => {
      if (com) return `<span class="c-c">${com}</span>`;
      if (str) return `<span class="c-s">${str}</span>`;
      if (kw) return `<span class="c-k">${kw}</span>`;
      if (dec) return `<span class="c-d">${dec}</span>`;
      if (num) return `<span class="c-n">${num}</span>`;
      if (fn) return `<span class="c-f">${fn}</span>`;
      return m;
    });
  }

  /* ---------------- mini markdown for notes ---------------- */
  function md(src) {
    const lines = src.trim().split('\n');
    let html = '', list = false, table = null;
    const para = [];
    const inline = s => s
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para.length = 0; } };
    const closeList = () => { if (list) { html += '</ul>'; list = false; } };
    const flushTable = () => {
      if (!table) return;
      html += '<table class="ntb"><tr>' + table[0].map(c => `<th>${inline(c)}</th>`).join('') + '</tr>' +
        table.slice(1).map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>';
      table = null;
    };
    let fence = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line.trimStart().startsWith('```')) {            // fenced code block
        if (fence === null) { flush(); closeList(); flushTable(); fence = []; }
        else { html += `<pre class="code">${py(fence.join('\n'))}</pre>`; fence = null; }
        continue;
      }
      if (fence !== null) { fence.push(raw); continue; }
      if (!line.trim()) { flush(); closeList(); flushTable(); continue; }
      if (line.startsWith('## ')) { flush(); closeList(); flushTable(); html += `<h4>${inline(line.slice(3))}</h4>`; }
      else if (line.startsWith('# ')) { flush(); closeList(); flushTable(); html += `<h3>${inline(line.slice(2))}</h3>`; }
      else if (line.startsWith('- ')) { flush(); flushTable(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(line.slice(2))}</li>`; }
      else if (line.startsWith('> ')) { flush(); closeList(); flushTable(); html += `<div class="nb">${inline(line.slice(2))}</div>`; }
      else if (line.startsWith('|') && line.endsWith('|')) {
        flush(); closeList();
        const cells = line.slice(1, -1).split('|').map(c => c.trim());
        if (cells.every(c => /^:?-+:?$/.test(c))) continue;
        (table = table || []).push(cells);
      }
      else { flushTable(); closeList(); para.push(line.trim()); }
    }
    flush(); closeList(); flushTable();
    return html;
  }

  /* ---------------- FX ---------------- */
  function heart(x, y) {
    const e = document.createElement('div');
    e.className = 'fx-heart'; e.textContent = '❤️';
    e.style.left = x + 'px'; e.style.top = y + 'px';
    document.body.appendChild(e);
    e.animate([
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .35 },
      { transform: 'translate(-50%,-110%) scale(1)', opacity: 0 }
    ], { duration: 900, easing: 'ease-out' }).onfinish = () => e.remove();
  }
  function confetti(container) {
    const r = container.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = Math.min(r.top + 120, innerHeight * .6);
    const colors = ['#a78bfa', '#34d399', '#ffd43b', '#fb7185', '#60a5fa', '#fb923c'];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('div');
      p.className = 'fx-p';
      const sz = 5 + Math.random() * 6;
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;background:${colors[i % colors.length]}`;
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2, v = 90 + Math.random() * 190;
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * v}px,${Math.sin(ang) * v + 130}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0 }
      ], { duration: 850 + Math.random() * 550, easing: 'cubic-bezier(.15,.6,.4,1)' }).onfinish = () => p.remove();
    }
  }

  SS.ui = {
    toast, shareReel, openSheet, closeSheets, bindReelSwipe,
    fillCode(data) {
      $('#codeTitle').textContent = data.code.title;
      $('#codeBody').innerHTML = py(data.code.body);
      $('#codeNotes').innerHTML = (data.code.annot || []).map(a => `<div>💡 ${a}</div>`).join('');
    },
    openCode(data, onClose) {
      if (!data.code) { onClose && onClose(); return; }
      SS.ui.fillCode(data);
      openSheet('code');
      onSheetClose = onClose || null;
    },
    openScript(title, paras, cur, onClose) {
      $('#scriptTitle').textContent = '📜 ' + title;
      $('#scriptBody').innerHTML = paras.map((p, i) => `<p${i === cur ? ' class="cur"' : ''}>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
      openSheet('script');
      onSheetClose = onClose || null;
      const c = $('#scriptBody .cur'); if (c) requestAnimationFrame(() => { c.scrollIntoView({ block: 'center' }); });
    },
    openMap() {
      const cur = SS.state.getLastReel();
      $('#mapBody').innerHTML = SS.catalog.stages.map(st => {
        const done = SS.state.completedCount(st.reels);
        const rows = st.reels.map(id => {
          const r = SS.catalog.reels.find(x => x.id === id);
          const ok = SS.state.isCompleted(id);
          return `<button class="map-row${id === cur ? ' cur' : ''}" data-id="${id}"><span class="mi">${ok ? '✅' : id === cur ? '▶️' : '○'}</span><span class="mt">${r.num}. ${r.topic}</span></button>`;
        }).join('');
        return `<div class="map-stage"><div class="map-sh"><b>${st.name}</b><span>${done}/${st.reels.length}</span></div>${rows}</div>`;
      }).join('');
      openSheet('map');
      const c = $('#mapBody .cur'); if (c) requestAnimationFrame(() => c.scrollIntoView({ block: 'center' }));
    },
    fillNotes(data) {
      $('#notesTitle').textContent = `📄 ${data.topic} — full notes`;
      $('#notesBody').innerHTML = md(data.notes);
      $('#notesBody').scrollTop = 0;
    },
    openNotes(data, onClose) {
      if (!data.notes) { onClose && onClose(); return; }
      SS.ui.fillNotes(data);
      openSheet('notes');
      onSheetClose = onClose || null;
    }
  };
  SS.fx = { heart, confetti };

  /* ---------------- settings ---------------- */
  function initSettings() {
    const sel = $('#voiceSel');
    const fill = () => {
      const vs = SS.narrator.voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
      sel.innerHTML = vs.map(v => {
        const mark = SS.narrator.isPremium(v) ? ' ✨' : '';
        const name = v.name.replace(/Microsoft |Google /, '');
        return `<option value="${v.voiceURI}">${name}${mark} — ${v.lang}</option>`;
      }).join('');
      if (SS.state.prefs.voiceURI) sel.value = SS.state.prefs.voiceURI;
      else if (SS.narrator.voiceName) sel.value = vs.find(v => v.name === SS.narrator.voiceName)?.voiceURI || '';
    };
    fill();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fill;
    sel.addEventListener('change', () => { SS.narrator.setVoice(sel.value); toast('🗣️ Voice updated'); });

    $('#voiceTest').addEventListener('click', () => {
      const v = SS.narrator.voices.find(x => x.voiceURI === sel.value);
      if (v) SS.narrator.preview(v);
    });

    const rate = $('#rateSel'), rateVal = $('#rateVal');
    rate.value = SS.state.prefs.rate || 1.05;
    rateVal.textContent = (+rate.value).toFixed(2).replace(/0$/, '') + '×';
    rate.addEventListener('input', () => {
      SS.narrator.setRate(+rate.value);
      rateVal.textContent = (+rate.value).toFixed(2).replace(/0$/, '') + '×';
    });

    const mute = $('#muteSel');
    mute.checked = SS.narrator.muted;
    mute.addEventListener('change', () => { SS.narrator.setMuted(mute.checked); document.dispatchEvent(new CustomEvent('ss:mute')); });
    document.addEventListener('ss:mute', () => { mute.checked = SS.narrator.muted; });

    const expr = $('#exprSel'), exprVal = $('#exprVal');
    expr.value = SS.narrator.expr;
    exprVal.textContent = Math.round(SS.narrator.expr * 100) + '%';
    expr.addEventListener('input', () => {
      SS.narrator.setExpr(+expr.value);
      exprVal.textContent = Math.round(expr.value * 100) + '%';
    });

    // playback speed / caption size / autoplay / reduce motion
    const pick = (sel, cur, apply) => {
      const box = $(sel);
      const paint = v => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
      paint(cur);
      box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; paint(b.dataset.v); apply(b.dataset.v); });
    };
    pick('#speedPick', SS.state.prefs.speed || 1, v => SS.audio.setSpeed(+v));
    pick('#sizePick', SS.state.prefs.textSize || 'm', v => { SS.state.prefs.textSize = v; SS.state.save(); applyLook(); });
    const auto = $('#autoSel'); auto.checked = SS.state.prefs.autonext !== false;
    auto.addEventListener('change', () => { SS.state.prefs.autonext = auto.checked; SS.state.save(); });
    const mo = $('#motionSel'); mo.checked = !!SS.state.prefs.reduceMotion;
    mo.addEventListener('change', () => { SS.state.prefs.reduceMotion = mo.checked; SS.state.save(); applyLook(); });
    $('#courseProgress').addEventListener('click', () => SS.ui.openMap());
    $('#mapBody').addEventListener('click', e => {
      const b = e.target.closest('.map-row'); if (!b) return;
      closeSheets(); SS.feed.goTo(b.dataset.id);
    });

    const fillStats = () => {
      const ids = SS.catalog.reels.map(r => r.id);
      $('#stDone').textContent = SS.state.completedCount(ids) + '/' + ids.length;
      $('#stStreak').textContent = SS.state.streak();
      $('#stXp').textContent = SS.state.xp();
    };
    $('#settingsBtn').addEventListener('click', () => {
      if (openName === 'settings') return closeSheets();
      fillStats();
      const p = SS.feed.activePlayer();   // reading settings pauses the reel too
      if (p) p.holdWhile(done => { openSheet('settings'); onSheetClose = done; });
      else openSheet('settings');
    });
    $('#aboutBtn').addEventListener('click', () => openSheet('about'));
    $('#resetBtn').addEventListener('click', () => {
      if (confirm('Reset all progress, likes and streak on this device?')) { SS.state.reset(); location.reload(); }
    });
  }

  /* ---------------- audio unlock + boot ---------------- */
  function unlock() {
    if (SS.audio && SS.audio.unlock) SS.audio.unlock();   // re-tries on every tap until iOS accepts
    if (SS.audioUnlocked) return;
    SS.audioUnlocked = true;
    SS.feed.kickActive();
  }
  // iOS Safari only lets audio start from the *end* of a tap (pointerdown doesn't count)
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
  window.addEventListener('contextmenu', e => { if (!e.target.closest('.sheet')) e.preventDefault(); });

  function applyLook() {
    const p = SS.state.prefs, root = document.documentElement;
    root.classList.remove('ts-s', 'ts-l');
    if (p.textSize === 's' || p.textSize === 'l') root.classList.add('ts-' + p.textSize);
    root.classList.toggle('reduce-motion', !!p.reduceMotion);
  }
  applyLook();

  function refreshStreak() { $('#streakCount').textContent = SS.state.streak(); }

  /* ---------------- PWA ---------------- */
  function initPwa() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    // when a new version takes over, reload once so the page never runs a stale mix of files
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }


  document.addEventListener('DOMContentLoaded', () => {
    SS.loadCatalog().then(() => {
      SS.feed.init();
      try { initSettings(); } catch (e) { console.error(e); }   // a settings glitch must never block playback
      refreshStreak();
      initPwa();
      document.addEventListener('ss:complete', refreshStreak);
      setTimeout(() => toast('👋 Tap ▶ to start — then swipe up'), 700);
    }).catch(e => {
      toast('⚠️ Could not load course catalog — check connection');
      console.error(e);
    });
  });
})();
