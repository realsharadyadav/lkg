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
    }

    _buildOverlays() {
      this.hookEl = h('div', 'hook', `<div class="hook-text">${mark(this.data.hook)}</div><div class="hook-skip">tap to skip</div>`);
      this.bigplay = h('div', 'bigplay', '▶');
      this.speedpill = h('div', 'speedpill', '⏩ 2×');
      this.root.querySelector('.reel-inner').append(this.hookEl, this.bigplay, this.speedpill);
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
      ['.recap', '.quiz', '.done-pop'].forEach(s => { const e = this.root.querySelector(s); if (e) e.remove(); });
      this.stage.classList.remove('frozen');
      this.paused = false; this.state = 'idle'; this.score = 0; this.quizIdx = 0;
      this.capText.innerHTML = '<span class="w">' + strip(this.data.hook) + '</span>';
      this._seg(0);
    }

    _begin() { this._hook(); }

    _hook() {
      this.state = 'hook';
      this.hookEl.style.display = 'flex';
      if (this._hookFX) { this._hookFX(); this._hookFX = null; }
      if (SS.motion) this._hookFX = SS.motion.hookFX(this.hookEl);
      const t = this.hookEl.querySelector('.hook-text');
      t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
      const say = SS.audio
        ? SS.audio.speak(this.data.id + '/hook', strip(this.data.hook), { onend: () => this._startScenes() })
        : this._say(strip(this.data.hook), () => this._startScenes());
      this.speech = say;
      this._after(3600, () => { if (this.state === 'hook') this._startScenes(); });
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
      this._seg(this.sceneIdx / this.data.scenes.length);
      this._syncChap();
      let ended = false;
      const go = () => { if (ended) return; ended = true; this.sceneIdx++; this._scene(); };
      // scenes without narration (e.g. bridges): hold a beat, move on — never crash
      if (sc.narration) {
        const key = `${this.data.id}/s${this.sceneIdx}`;
        this.speech = SS.audio
          ? SS.audio.speak(key, strip(sc.narration), { onend: () => this._after(600, go) })
          : SS.narrator.speak(strip(sc.narration), { onend: () => this._after(600, go) });
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
      this.speech = SS.audio
        ? SS.audio.speak(this.data.id + '/recap', say, { onend: () => this._after(700, () => this._quiz()) })
        : SS.narrator.speak(say, { onend: () => this._after(700, () => this._quiz()) });
      this._after(SS.narrator.estMs(say) * 2.2 + 3000, () => this._quiz());
    }

    _quiz() {
      if (this.state !== 'recap' && this.state !== 'quiz') return;
      this.state = 'quiz';
      this._stopSpeech(); this._clearTimers();
      const q = this.data.quiz[this.quizIdx];
      const n = this.data.quiz.length;
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
      if (first) { SS.fx.confetti(this.root); }
      const n = this.data.quiz.length;
      const perfect = this.score === n;
      const pop = h('div', 'done-pop',
        `<div class="ck">${perfect ? '🏆' : this.score >= n - 1 ? '✅' : '💪'}</div>` +
        `<b>Reel complete — ${this.score}/${n}</b>` +
        `<small>${perfect ? 'Perfect score!' : 'swipe ↑ for the next reel'}</small>`);
      this.root.querySelector('.reel-inner').appendChild(pop);
      this._caption('✅ Done! Swipe up for the next reel');
      this.hint.classList.add('show');
      document.dispatchEvent(new CustomEvent('ss:complete', { detail: { id: this.data.id } }));
      this._after(2600, () => pop.remove());
    }

    /* ---------- input ---------- */
    tap() {
      if (this._pending) return;
      if (this.state === 'hook') return this.skipHook();
      if (this.state === 'quiz' || this.state === 'done' || this.state === 'idle') return;
      this.togglePause();
    }
    togglePause() { if (this.paused) this._resume(); else this._pause(); }
    _pause() {
      if (this.paused || this.state === 'idle') return;
      this.paused = true;
      this._stopSpeech(); this._clearTimers();
      this.stage.classList.add('frozen');
      this.bigplay.textContent = '❚❚'; this.bigplay.classList.add('show');
    }
    _resume() {
      if (!this.paused) return;
      this.paused = false;
      this.stage.classList.remove('frozen');
      this.bigplay.classList.remove('show');
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
      // full text, fully readable from the first moment — no word-by-word dimming.
      // user reads at their own pace; the text area is scrollable for long narrations.
      if (this.karaokeStop) { this.karaokeStop(); this.karaokeStop = null; }
      this.capText.innerHTML = '<span class="w on">' + strip(text) + '</span>';
    }
    _say(text, onend) { this.speech = SS.narrator.speak(text, { onend }); }
    _stopSpeech() { if (this.speech) { this.speech.cancel(); this.speech = null; } if (this.karaokeStop) { this.karaokeStop(); this.karaokeStop = null; } }
    _clearScene() { if (this.sceneCleanup) { try { this.sceneCleanup(); } catch (e) {} this.sceneCleanup = null; } this.stage.innerHTML = ''; }
    _after(ms, fn) { const t = setTimeout(() => { if (!this.paused && this.state !== 'idle') fn(); }, ms); this.timers.push(t); return t; }
    _clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
    _seg(frac) {
      const seg = this.ctx.segEl; if (!seg) return;
      seg.classList.add('live');
      seg.querySelector('b').style.width = Math.round(frac * 100) + '%';
    }
  }

  SS.ReelPlayer = ReelPlayer;
})();
