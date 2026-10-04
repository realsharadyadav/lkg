/* LKG — reel player: hook -> chaptered scenes -> recap -> 3-question quiz -> done.
   Scene timing is narration-driven (advance on speech end, capped by estimate).
   Reel JSON: {id,num,track,stage,topic,hook,chapters[],scenes[{type,chapter,narration,...}],recap[],quiz[{q,opts,a,why}]x3,code{},notes} */
(function () {
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const strip = s => s.replace(/\*\*/g, '').replace(/\*/g, '');
  const mark = s => s.replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');

  class ReelPlayer {
    constructor(root, data, ctx) {
      this.root = root; this.data = data; this.ctx = ctx; // ctx: {segEl, total}
      this.stage = root.querySelector('.stage');
      this.capText = root.querySelector('.cap-text');
      this.hint = root.querySelector('.cap-hint');
      this.state = 'idle'; this.paused = false;
      this.timers = []; this.speech = null; this.sceneCleanup = null; this.karaokeStop = null;
      this.speedMult = 1;
      this.score = 0; this.quizIdx = 0;
      this._buildOverlays();
      this._buildChapBar();
      this._syncRail();
      this.capText.addEventListener('pointerdown', e => e.stopPropagation());
      this.capText.addEventListener('click', () => this._openScript());
    }

    /* tap the one-line caption -> full script popup (playback holds while reading) */
    _openScript() {
      if (!this._capFull || this._pending) return;
      const sc = this.data.scenes;
      const live = this.state === 'scene';
      const paras = live ? sc.map(s => strip(s.narration || s.title || '')) : [this._capFull];
      const wasPaused = this.paused;
      if (!wasPaused && (live || this.state === 'recap' || this.state === 'hook')) this._pause();
      SS.ui.openScript(this.data.topic, paras, live ? this.sceneIdx : 0, () => { if (!wasPaused && this.paused) this._resume(); });
    }

    _buildOverlays() {
      this.hookEl = h('div', 'hook', `<div class="hook-text">${mark(this.data.hook)}</div><div class="hook-skip">tap to skip</div>`);
      this.bigplay = h('div', 'bigplay', '▶');
      this.speedpill = h('div', 'speedpill', '⏩ 2×');
      this.audBar = h('div', 'aud-bar', '<b></b>');
      this.audBar.setAttribute('role', 'progressbar'); this.audBar.setAttribute('aria-label', 'Narration progress');
      this.audHit = h('div', 'aud-hit');
      this.root.querySelector('.reel-inner').append(this.hookEl, this.bigplay, this.speedpill, this.audBar, this.audHit);
      this._bindScrub();
    }

    _buildChapBar() {
      const bar = h('div', 'chapbar');
      (this.data.chapters || []).forEach((c, i) => {
        const b = h('button', 'chap-dot', `<i></i><span>${i + 1}</span>`);
        b.title = c;
        b.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + c);
        b.addEventListener('pointerdown', e => e.stopPropagation());
        b.addEventListener('click', e => { e.stopPropagation(); this.jumpToChapter(i); });
        bar.appendChild(b);
      });
      const zone = this.root.querySelector('.capzone');
      zone.insertBefore(bar, this.capText);
      this.chapBar = bar;
      this.chapChip = this.root.querySelector('.chap-chip');
    }

    _syncChap() {
      const sc = this.data.scenes[this.sceneIdx];
      const c = sc && sc.chapter != null ? sc.chapter : (this.data.chapters.length - 1);
      [...this.chapBar.children].forEach((b, i) => b.classList.toggle('on', i === c));
      const n = this.data.chapters.length;
      if (this.chapChip) this.chapChip.textContent = n ? `CHAPTER ${c + 1}/${n} · ${this.data.chapters[c]}` : '';
    }

    jumpToChapter(c) {
      if (this.paused) return;
      if (this.state !== 'scene' && this.state !== 'recap') return;
      const idx = this.data.scenes.findIndex(s => s.chapter === c);
      if (idx < 0) return;
      this.state = 'scene';
      this._clearTimers(); this._stopSpeech();
      this.root.querySelectorAll('.recap').forEach(e => e.remove());
      this.sceneIdx = idx;
      this._scene();
    }

    _syncRail() {
      const likeBtn = this.root.querySelector('.rail-like');
      const base = (this.data.num * 37) % 800 + 120;
      this.likeBase = base;
      likeBtn.querySelector('.lb').textContent = this._fmt(base + (SS.state.isLiked(this.data.id) ? 1 : 0));
      likeBtn.classList.toggle('liked', SS.state.isLiked(this.data.id));
      this.root.querySelector('.rail-mute .ic').textContent = SS.narrator.muted ? '🔇' : '🔊';
    }
    _fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : '' + n; }

    /* ---------- lifecycle ---------- */
    start() {
      this.stop();
      if (!SS.audioUnlocked) { this.bigplay.classList.add('show'); this._pending = true; return; }
      this._begin();
    }
    kick() { if (this._pending) { this._pending = false; this.bigplay.classList.remove('show'); this._begin(); } }
    stop() {
      this._clearTimers(); this._stopSpeech(); this._clearScene();
      if (this._hookFX) { this._hookFX(); this._hookFX = null; }
      this.hookEl.style.display = 'none';
      this.bigplay.classList.remove('show');
      this.speedpill.classList.remove('show');
      ['.recap', '.quiz', '.done-pop', '.nextup'].forEach(s => { const e = this.root.querySelector(s); if (e) e.remove(); });
      this.stage.classList.remove('frozen');
      this.paused = false; this._kept = false; this.state = 'idle'; this.score = 0; this.quizIdx = 0;
      this._setCap(strip(this.data.hook));
      this._prog(0);
      this._seg(0);
    }

    _begin() {
      this._beganAt = performance.now();
      const at = SS.state.takeResume(this.data.id);
      if (at > 0 && at < this.data.scenes.length) {
        this.hookEl.style.display = 'none';
        this.sceneIdx = at;
        SS.ui.toast('↩︎ Picking up where you left off');
        this._scene();
      } else this._hook();
    }

    _hook() {
      this.state = 'hook';
      this.hookEl.style.display = 'flex';
      if (this._hookFX) { this._hookFX(); this._hookFX = null; }
      if (SS.motion) this._hookFX = SS.motion.hookFX(this.hookEl);
      const t = this.hookEl.querySelector('.hook-text');
      t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
      // advance only when the hook line has finished (+ a short beat); the timer is just a safety net
      const hookText = strip(this.data.hook);
      this.speech = this._voice(this.data.id + '/hook', hookText, () => this._after(450, () => this._startScenes()));
      this._after(SS.narrator.estMs(hookText) * 2.2 + 3000, () => { if (this.state === 'hook') this._startScenes(); });
    }
    /* drag the bottom bar to seek inside the current narration clip */
    _bindScrub() {
      const hit = this.audHit;
      const frac = e => { const r = hit.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
      let drag = false;
      hit.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (!this.speech || !this.speech.seek || this.state === 'quiz' || this.state === 'done') return;
        drag = true; hit.setPointerCapture(e.pointerId); this._prog(frac(e));
      });
      hit.addEventListener('pointermove', e => { if (drag) this._prog(frac(e)); });
      const end = e => { if (!drag) return; drag = false; this.speech && this.speech.seek && this.speech.seek(frac(e)); };
      hit.addEventListener('pointerup', e => { e.stopPropagation(); end(e); });
      hit.addEventListener('pointercancel', () => { drag = false; });
    }

    /* previous / next scene (edge taps) */
    seekScene(delta) {
      if (this._pending) return;
      if (this.state === 'hook') return this.skipHook();
      if (this.state !== 'scene' && this.state !== 'recap') return;
      const n = this.data.scenes.length;
      let idx = this.state === 'recap' ? (delta < 0 ? n - 1 : n) : this.sceneIdx + delta;
      idx = Math.max(0, idx);
      if (this.state === 'recap' && delta > 0) return;
      if (this.paused) { this.paused = false; this._kept = false; this.stage.classList.remove('frozen'); this.bigplay.classList.remove('show'); }
      this._clearTimers(); this._stopSpeech();
      this.root.querySelectorAll('.recap').forEach(e => e.remove());
      if (idx >= n) return this._recap();
      this.state = 'scene'; this.sceneIdx = idx;
      this._scene();
    }

    /* narrate one clip and drive the bottom audio progress bar */
    _voice(key, text, onend) {
      this._sents = null; this._sentIdx = -1;
      if (this.state === 'scene') {
        const parts = text.match(/[^.?!…]+[.?!…]+["'”’)]?\s*|[^.?!…]+$/g) || [];
        if (parts.length > 1) {
          let acc = 0; const total = text.length || 1;
          this._sents = parts.map(s => { acc += s.length; return { s: s.trim(), end: acc / total }; });
        }
      }
      this._prog(0);
      return SS.audio
        ? SS.audio.speak(key, text, { onend, onprogress: f => this._prog(f), onblocked: () => this._blocked() })
        : SS.narrator.speak(text, { onend, onword: (i, n) => this._prog((i + 1) / n) });
    }
    /* the browser refused to start sound (no recent tap): show ▶ and restart the clip on the next tap */
    _blocked() {
      if (this.paused || this.state === 'idle' || this.state === 'done' || this.state === 'quiz') return;
      this._pause();
      this._kept = false;
      this._stopSpeech();
    }
    _prog(f) {
      if (!this.audBar) return;
      f = Math.max(0, Math.min(1, f));
      this.audBar.firstChild.style.transform = 'scaleX(' + f + ')';
      if (this._sents) {   // one-line caption follows the sentence being spoken
        let i = this._sents.findIndex(x => f <= x.end); if (i < 0) i = this._sents.length - 1;
        if (i !== this._sentIdx) { this._sentIdx = i; this.capText.textContent = this._sents[i].s; }
      }
    }
    skipHook() { if (this.state === 'hook') this._startScenes(); }

    _startScenes() {
      if (this.state !== 'hook' && this.state !== 'idle') return;
      this.hookEl.style.display = 'none';
      this._stopSpeech(); this._clearTimers();
      this.sceneIdx = 0;
      this._scene();
    }

    _scene() {
      const sc = this.data.scenes[this.sceneIdx];
      if (!sc) return this._recap();
      this.state = 'scene';
      // run scene cleanup only — old DOM is handed to the exit transition
      const olds = [...this.stage.querySelectorAll('.scene')];
      if (this.sceneCleanup) { try { this.sceneCleanup(); } catch (e) {} this.sceneCleanup = null; }
      const mount = h('div', 'scene');
      this.stage.appendChild(mount);
      const render = SS.scenes[sc.type] || SS.scenes.bigtext;
      this.sceneCleanup = render(mount, sc, { accent: getComputedStyle(this.root).getPropertyValue('--accent'), durMs: sc.narration ? SS.narrator.estMs(sc.narration) * 2.2 : 9000 });
      if (SS.motion) SS.motion.transition(this.stage, olds, mount);
      else olds.forEach(l => l.remove());
      this._caption(sc.narration || sc.title || '');
      SS.state.setScene(this.data.id, this.sceneIdx);
      this._seg(this.sceneIdx / this.data.scenes.length);
      this._syncChap();
      let ended = false;
      const go = () => { if (ended) return; ended = true; this.sceneIdx++; this._scene(); };
      // scenes without narration (e.g. bridges): hold a beat, move on — never crash
      if (sc.narration) {
        const key = `${this.data.id}/s${this.sceneIdx}`;
        this.speech = this._voice(key, strip(sc.narration), () => this._after(600, go));
        this._after(SS.narrator.estMs(sc.narration) * 2.2 + 3100, go);
      } else {
        this._after(4500, go);
      }
    }

    _recap() {
      this.state = 'recap';
      this._clearScene(); this._stopSpeech();
      this._seg(1);
      this._syncChap();
      this._caption('Quick recap — the things to remember 👇');
      const layer = h('div', 'recap', `<div class="recap-h">🧠 Remember this</div>`);
      this.data.recap.forEach((r, i) => {
        const c = h('div', 'recap-card', `<span class="n">${i + 1}</span><span>${mark(r)}</span>`);
        layer.appendChild(c);
        setTimeout(() => c.classList.add('pop'), 500 + i * 1500);
      });
      this.root.querySelector('.reel-inner').appendChild(layer);
      const say = 'Remember these. First: ' + strip(this.data.recap[0]) +
        '. Also: ' + strip(this.data.recap[1]) +
        (this.data.recap[2] ? '. And finally: ' + strip(this.data.recap[2]) : '') +
        '. Now — a quick check.';
      this.speech = this._voice(this.data.id + '/recap', say, () => this._after(700, () => this._quiz()));
      this._after(SS.narrator.estMs(say) * 2.2 + 3000, () => this._quiz());
    }

    _quiz() {
      if (this.state !== 'recap' && this.state !== 'quiz') return;
      this.state = 'quiz';
      this._stopSpeech(); this._clearTimers();
      const q = this.data.quiz[this.quizIdx];
      const n = this.data.quiz.length;
      this._prog(0);
      this._caption(`Quiz ${this.quizIdx + 1}/${n} — tap the right answer ✅`);
      this.root.querySelectorAll('.quiz').forEach(e => e.remove());
      const layer = h('div', 'quiz');
      const card = h('div', 'quiz-card',
        `<span class="quiz-tag">⚡ Question ${this.quizIdx + 1} of ${n}</span><div class="quiz-q">${mark(q.q)}</div>` +
        `<div class="quiz-opts">${q.opts.map((o, i) => `<button class="quiz-opt" data-i="${i}" style="animation-delay:${i * 90}ms"><span class="k">${'ABCD'[i]}</span>${strip(o)}</button>`).join('')}</div>` +
        `<div class="quiz-why">💡 ${mark(q.why)}</div><button class="quiz-next">Continue ➜</button><div class="quiz-done"></div>`);
      layer.appendChild(card);
      this.root.querySelector('.reel-inner').appendChild(layer);
        if (SS.audio) SS.audio.speak(`${this.data.id}/quiz${this.quizIdx}_q`, strip(q.q), {});
        else SS.narrator.speak(strip(q.q));
      card.querySelectorAll('.quiz-opt').forEach(btn => btn.addEventListener('click', () => {
        if (card.dataset.locked) return;
        card.dataset.locked = '1';
        const i = +btn.dataset.i, right = i === q.a;
        if (right) this.score++;
        btn.classList.add(right ? 'right' : 'wrong');
        card.querySelectorAll('.quiz-opt').forEach((b, j) => { if (j !== i) b.classList.add(j === q.a ? 'right' : 'dim'); b.disabled = true; });
        card.querySelector('.quiz-why').classList.add('show');
        const next = card.querySelector('.quiz-next');
        next.classList.add('show');
        const last = this.quizIdx + 1 >= n;
        next.textContent = right ? (last ? 'Finish 🎉' : 'Nice! Next ➜') : (last ? 'Finish 🎉' : 'Got it — Next ➜');
        if (right) SS.fx.confetti(card);
        if (SS.audio) {
          // shared prefix clip, then the per-quiz explanation — one voice throughout
          SS.audio.speak(right ? '_fx/correct' : '_fx/notquite', '', {
            onend: () => SS.audio.speak(`${this.data.id}/quiz${this.quizIdx}_why`, strip(q.why), {})
          });
        } else {
          SS.narrator.speak(right ? 'Correct! ' + strip(q.why) : 'Not quite. ' + strip(q.why));
        }
        next.addEventListener('click', () => {
          if (last) this._complete(layer);
          else { this.quizIdx++; this._quiz(); }
        }, { once: true });
      }));
    }

    _complete(quizLayer) {
      this.state = 'done';
      SS.narrator.cancel();
      quizLayer.remove();
      const recap = this.root.querySelector('.recap'); if (recap) recap.remove();
      const first = !SS.state.isCompleted(this.data.id);
      SS.state.markCompleted(this.data.id);
      SS.state.clearScene();
      if (first) { SS.fx.confetti(this.root); }
      const n = this.data.quiz.length;
      const perfect = this.score === n;
      const xp = this.score * 10 + (first ? 20 : 0) + (perfect ? 10 : 0);
      SS.state.addXp(xp);
      const pop = h('div', 'done-pop',
        `<div class="ck">${perfect ? '🏆' : this.score >= n - 1 ? '✅' : '💪'}</div>` +
        `<b>Reel complete — ${this.score}/${n}</b>` +
        `<small>${perfect ? 'Perfect score!' : 'swipe ↑ for the next reel'}</small>` +
        `<div class="xp-line">+${xp} XP · 🔥 ${SS.state.streak()}-day streak</div>`);
      this.root.querySelector('.reel-inner').appendChild(pop);
      this._caption('✅ Done! Swipe up for the next reel');
      this.hint.classList.add('show');
      document.dispatchEvent(new CustomEvent('ss:complete', { detail: { id: this.data.id } }));
      this._after(2600, () => { pop.remove(); this._autoNext(); });
    }

    /* "Next up" countdown; tap it to stay on this reel */
    _autoNext() {
      if (!SS.state.prefs.autonext || this.state !== 'done') return;
      const label = SS.feed.nextLabel(this.data.id);
      if (!label) return;
      let n = 4;
      const chip = h('button', 'nextup');
      const paint = () => { chip.innerHTML = `<span>Next · ${label}</span><b>${n}</b><i>tap to stay</i>`; };
      paint();
      chip.addEventListener('pointerdown', e => e.stopPropagation());
      chip.addEventListener('click', e => { e.stopPropagation(); this._clearTimers(); chip.remove(); });
      this.root.querySelector('.reel-inner').appendChild(chip);
      const tick = () => { if (--n <= 0) { chip.remove(); SS.feed.next(); } else { paint(); this._after(1000, tick); } };
      this._after(1000, tick);
    }

    /* ---------- input ---------- */
    tap() {                  // returns true when it toggled pause (so a double-tap can undo it)
      if (this._pending) return false;
      // the tap that unlocked audio / started the reel must not skip its intro
      if (this.state === 'hook') { if (performance.now() - (this._beganAt || 0) > 700) this.skipHook(); return false; }
      if (this.state === 'quiz' || this.state === 'done' || this.state === 'idle') return false;
      this.togglePause();
      return true;
    }
    togglePause() { if (this.paused) this._resume(); else this._pause(); }
    _pause() {
      if (this.paused || this.state === 'idle') return;
      this.paused = true;
      // hold narration + pending timers in place so resume continues mid-sentence
      this._holdTimers();
      this._kept = !!(this.speech && this.speech.pause);
      if (this._kept) this.speech.pause(); else { this._stopSpeech(); }
      this.stage.classList.add('frozen');
      this.bigplay.textContent = '▶'; this.bigplay.classList.add('show');
    }
    _resume() {
      if (!this.paused) return;
      this.paused = false;
      this.stage.classList.remove('frozen');
      this.bigplay.classList.remove('show');
      if (this._kept) { this._kept = false; this._releaseTimers(); this.speech.resume(); return; }
      const s = this.state;
      if (s === 'scene') { this.sceneIdx = Math.min(this.sceneIdx, this.data.scenes.length - 1); this._scene(); }
      else if (s === 'recap') this._recap();
      else if (s === 'hook') this._hook();
    }
    pressStart() {           // long-press: pause (release resumes)
      if (this.paused || this.state === 'quiz' || this.state === 'done' || this.state === 'idle') return;
      this._pause();
    }
    pressEnd() {
      if (!this.paused) return;
      this._resume();
    }
    _speakOnly() {
      const sc = this.data.scenes[this.sceneIdx];
      if (!sc) return;
      let ended = false;
      const go = () => { if (ended) return; ended = true; this.sceneIdx++; this._scene(); };
      if (!sc.narration) { this._after(2000, go); return; }
      this.speech = SS.audio
        ? SS.audio.speak(`${this.data.id}/s${this.sceneIdx}`, strip(sc.narration), { onend: go })
        : SS.narrator.speak(strip(sc.narration), { onend: go });
      this._after(SS.narrator.estMs(sc.narration) * 2.2 + 2500, go);
    }

    like(x, y) {
      const on = SS.state.toggleLike(this.data.id);
      this._syncRail();
      if (on && x != null) SS.fx.heart(x, y);
    }

    /* ---------- helpers ---------- */
    _caption(text) {
      // One clipped line (CSS ellipsis); tapping it opens the full script.
      this._setCap(strip(text));
    }
    _setCap(text) { this._capFull = text; this._sents = null; this.capText.textContent = text; }
    _say(text, onend) { this.speech = SS.narrator.speak(text, { onend }); }
    _stopSpeech() { if (this.speech) { this.speech.cancel(); this.speech = null; } if (this.karaokeStop) { this.karaokeStop(); this.karaokeStop = null; } }
    _clearScene() { if (this.sceneCleanup) { try { this.sceneCleanup(); } catch (e) {} this.sceneCleanup = null; } this.stage.innerHTML = ''; }
    _after(ms, fn) {
      const t = { left: ms, at: Date.now(), id: 0 };
      t.run = () => { this.timers = this.timers.filter(x => x !== t); if (!this.paused && this.state !== 'idle') fn(); };
      t.id = setTimeout(t.run, ms);
      this.timers.push(t);
      return t;
    }
    _clearTimers() { this.timers.forEach(t => clearTimeout(t.id)); this.timers = []; }
    _holdTimers() { this.timers.forEach(t => { clearTimeout(t.id); t.left -= Date.now() - t.at; }); }
    _releaseTimers() { this.timers.forEach(t => { t.at = Date.now(); t.id = setTimeout(t.run, Math.max(0, t.left)); }); }
    _seg(frac) {
      const seg = this.ctx.segEl; if (!seg) return;
      seg.classList.add('live');
      seg.querySelector('b').style.width = Math.round(frac * 100) + '%';
    }
  }

  SS.ReelPlayer = ReelPlayer;
})();
