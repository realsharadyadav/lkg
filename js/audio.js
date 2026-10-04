/* LKG — neural voiceover playback.
   Speaks via pre-generated mp3s (Kokoro voice) with automatic fallback to the
   browser's speechSynthesis when a clip is missing. Same contract as
   SS.narrator.speak: SS.audio.speak(key, text, cb) -> handle {cancel}.      */
(function () {
  const SS = window.SS;

  function playFile(url, cb) {
    const a = new Audio(url);
    let settled = false;
    const ok = () => { if (!settled) { settled = true; cb && cb.onend && cb.onend(); } };
    const fail = () => {
      if (settled) return;
      settled = true;
      cb && cb.onerror ? cb.onerror() : null;
    };
    a.addEventListener('ended', ok);
    a.addEventListener('error', fail);
    const p = a.play();
    if (p && p.catch) p.catch(fail);
    return {
      cancel() { settled = true; try { a.pause(); } catch (e) {} },
      pause() { try { a.pause(); } catch (e) {} },
      resume() { if (a.ended) return; const r = a.play(); if (r && r.catch) r.catch(() => {}); }
    };
  }

  /* key: e.g. 'PY-01/hook', 'PY-01/s3', 'PY-01/recap', 'PY-01/quiz0_q',
          'PY-01/quiz0_why', '_fx/correct', '_fx/notquite'                    */
  function speak(key, text, cb) {
    cb = cb || {};
    // muted: stay silent but keep timing so scenes still advance
    if (SS.narrator.muted || !('Audio' in window)) {
      const ms = Math.max(1500, SS.narrator.estMs(text || ''));
      let t = setTimeout(() => cb.onend && cb.onend(), ms), left = ms, at = Date.now();
      return {
        cancel() { clearTimeout(t); },
        pause() { clearTimeout(t); left -= Date.now() - at; },
        resume() { at = Date.now(); t = setTimeout(() => cb.onend && cb.onend(), Math.max(0, left)); }
      };
    }
    // clip missing -> browser voice; the handle follows whichever is active
    let inner = null, cancelled = false;
    const handle = {
      cancel() { cancelled = true; inner && inner.cancel(); },
      pause() { inner && inner.pause && inner.pause(); },
      resume() { inner && inner.resume && inner.resume(); }
    };
    inner = playFile('data/audio/' + key + '.mp3', {
      onend: () => cb.onend && cb.onend(),
      onerror: () => { if (!cancelled) inner = SS.narrator.speak(text, cb); }
    });
    return handle;
  }

  SS.audio = { speak };
})();
