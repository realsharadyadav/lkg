/* LKG — neural voiceover playback.
   Speaks via pre-generated mp3s (Kokoro voice) with automatic fallback to the
   browser's speechSynthesis when a clip is missing. Same contract as
   SS.narrator.speak: SS.audio.speak(key, text, cb) -> handle {cancel}.      */
(function () {
  const SS = window.SS;

  /* ONE shared <audio> element for every clip. iOS Safari only lets an element play
     sound after it has been started from a tap; a fresh `new Audio()` per clip can be
     refused once the tap is over (swipes, auto-advance). Unlock it once, reuse forever. */
  const el = new Audio();
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  let token = 0, unlocked = false;
  const speed = () => SS.state.prefs.speed || 1;
  const SILENT = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA';

  /* call from inside a tap handler */
  function unlock() {
    // a clip already playing means the element is unlocked; never interrupt it
    if (unlocked || !el.paused) { unlocked = unlocked || !el.paused; return; }
    const t = ++token;
    try {
      el.src = SILENT;
      const p = el.play();
      if (p && p.then) p.then(() => { unlocked = true; if (t === token) el.pause(); }).catch(() => {});
      else unlocked = true;
    } catch (e) {}
    // iOS speechSynthesis (fallback voice) also needs one utterance from a tap
    try { if ('speechSynthesis' in window && !SS.narrator.muted) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) {}
  }

  function playFile(url, cb) {
    const t = ++token;
    let settled = false, raf = 0;
    const mine = () => t === token;
    const ok = () => { if (!settled && mine()) { settled = true; cb.onend && cb.onend(); } };
    const fail = err => {
      if (settled || !mine()) return;
      settled = true;
      if (err && err.name === 'NotAllowedError' && cb.onblocked) cb.onblocked();
      else if (cb.onerror) cb.onerror();
    };
    // smooth (rAF) progress for the bottom audio bar
    const tick = () => {
      if (settled || !mine()) return;
      if (cb.onprogress && isFinite(el.duration) && el.duration > 0) cb.onprogress(el.currentTime / el.duration);
      raf = requestAnimationFrame(tick);
    };
    el.onplaying = () => {
      if (!mine()) return;
      unlocked = true;
      if (el.playbackRate !== speed()) el.playbackRate = speed();   // only touch the rate when it differs
      cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    };
    el.onended = () => { if (!mine()) return; cb.onprogress && cb.onprogress(1); ok(); };
    el.onerror = () => fail();
    el.src = url;
    const p = el.play();
    if (p && p.catch) p.catch(err => { if (err && err.name === 'AbortError') return; fail(err); });
    return {
      cancel() { if (mine()) { settled = true; try { el.pause(); } catch (e) {} } },
      seek(f) { if (mine() && isFinite(el.duration) && el.duration > 0) el.currentTime = Math.max(0, Math.min(.999, f)) * el.duration; },
      pause() { if (mine()) try { el.pause(); } catch (e) {} },
      resume() { if (!mine() || settled || el.ended) return; const r = el.play(); if (r && r.catch) r.catch(err => fail(err)); }
    };
  }

  /* key: e.g. 'PY-01/hook', 'PY-01/s3', 'PY-01/recap', 'PY-01/quiz0_q',
          'PY-01/quiz0_why', '_fx/correct', '_fx/notquite'                    */
  function speak(key, text, cb) {
    cb = cb || {};
    // muted: stay silent but keep timing so scenes still advance
    if (SS.narrator.muted || !('Audio' in window)) {
      const ms = Math.max(1500, SS.narrator.estMs(text || '')) / speed();
      let iv = 0, t = setTimeout(() => { clearInterval(iv); cb.onprogress && cb.onprogress(1); cb.onend && cb.onend(); }, ms), left = ms, at = Date.now(), paused = false;
      iv = setInterval(() => { if (!paused && cb.onprogress) cb.onprogress(Math.min(1, 1 - (left - (Date.now() - at)) / ms)); }, 100);
      return {
        cancel() { clearTimeout(t); clearInterval(iv); },
        pause() { paused = true; clearTimeout(t); left -= Date.now() - at; },
        resume() { paused = false; at = Date.now(); t = setTimeout(() => { clearInterval(iv); cb.onend && cb.onend(); }, Math.max(0, left)); }
      };
    }
    // clip missing -> browser voice; the handle follows whichever is active
    let inner = null, cancelled = false;
    const handle = {
      cancel() { cancelled = true; inner && inner.cancel(); },
      seek(f) { inner && inner.seek && inner.seek(f); },
      pause() { inner && inner.pause && inner.pause(); },
      resume() { inner && inner.resume && inner.resume(); }
    };
    inner = playFile('data/audio/' + key + '.mp3', {
      onend: () => cb.onend && cb.onend(),
      onerror: () => { if (!cancelled) inner = SS.narrator.speak(text, Object.assign({}, cb, { onword: (i, n) => cb.onprogress && cb.onprogress((i + 1) / n) })); },
      onprogress: cb.onprogress,
      onblocked: cb.onblocked
    });
    return handle;
  }

  SS.audio = {
    speak,
    unlock,
    setSpeed(v) { SS.state.prefs.speed = v; SS.state.save(); try { el.playbackRate = v; } catch (e) {} }
  };
})();
