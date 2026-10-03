/* SwipeScript AI — narration engine (Web Speech API)
   - prefers premium "Natural" voices automatically
   - speaks sentence-by-sentence with expressiveness: pitch rises on questions,
     energy on exclamations, organic per-sentence variation (no more robot monotone)
   - word-sync karaoke captions via estimated timing */
(function () {
  let voices = [], voice = null, voiceName = '';
  let baseRate = SS.state.prefs.rate || 1.05;
  let rate = baseRate;
  let muted = !!SS.state.prefs.muted;
  let expr = SS.state.prefs.expr != null ? SS.state.prefs.expr : 0.6;

  const PREMIUM = ['Natural', 'Neural', 'Samantha', 'Karen', 'Moira', 'Tessa', 'Daniel', 'Google US English', 'Google UK English Female', 'Aria', 'Jenny', 'Guy', 'Ava', 'Zira', 'Alex'];
  const rank = v => { const n = (v.name || '').toLowerCase(); let i = PREMIUM.findIndex(p => n.includes(p.toLowerCase())); return i === -1 ? PREMIUM.length : i; };

  function pickVoice() {
    let all = (speechSynthesis.getVoices() || []).filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (!all.length) all = speechSynthesis.getVoices() || [];
    const saved = SS.state.prefs.voiceURI;
    voice = (saved && all.find(v => v.voiceURI === saved)) || null;
    if (!voice && all.length) voice = [...all].sort((a, b) => rank(a) - rank(b))[0];
    voiceName = voice ? voice.name : 'auto';
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  const wps = () => 2.55 * rate;                 // approx words per second
  const estMs = text => Math.max(1700, (text.trim().split(/\s+/).length / wps()) * 1000 + 550);

  /* word-index lookup for boundary events */
  function wordSpans(text) {
    const out = []; let idx = 0;
    for (const m of text.matchAll(/\S+/g)) { out.push({ w: m[0], start: m.index, i: idx++ }); }
    return out;
  }
  const sentences = text => (text.match(/[^.?!…]+[.?!…]+["'”’)]?|[^.?!…]+$/g) || [text]).map(s => s.trim()).filter(Boolean);
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  /* Speak text. cb: {onword(i,total), onend} -> handle {cancel} */
  function speak(text, cb) {
    cb = cb || {};
    const sents = sentences(text);
    const words = wordSpans(text);
    if (muted || !('speechSynthesis' in window)) {
      const t = setTimeout(() => cb.onend && cb.onend(), estMs(text));
      return { cancel: () => clearTimeout(t) };
    }
    let cancelled = false, ended = false, cur = null;
    const t0 = Date.now();
    const offsets = []; let acc = 0;
    sents.forEach(s => { offsets.push(acc); acc += s.split(/\s+/).filter(Boolean).length; });
    /* never let spurious end/error events skip ahead of the narration —
       the earliest we may declare "finished" is 70% of the estimated read time */
    const minMs = estMs(text) * 0.7;
    const finish = () => {
      if (cancelled || ended) return;
      const wait = minMs - (Date.now() - t0);
      if (wait > 0) { setTimeout(finish, wait); return; }
      ended = true; cb.onend && cb.onend();
    };
    const localWord = (s, charIdx) => {
      let n = 0;
      for (const m of s.matchAll(/\S+/g)) { if (m.index <= charIdx) n++; else break; }
      return Math.max(0, n - 1);
    };
    const pitchAmp = 0.10 * expr, rateAmp = 0.05 * expr;
    const next = (si, attempt) => {
      if (cancelled || ended) return;
      if (si >= sents.length) return finish();
      const s = sents[si];
      const u = new SpeechSynthesisUtterance(s);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
      const h = hash(s + si);
      let p = 1 + (((h % 9) - 4) / 4) * pitchAmp;          // organic variation per sentence
      let r = rate * (1 + ((((h >> 4) % 7) - 3) / 3) * rateAmp);
      if (s.endsWith('?')) { p += 0.12 * expr; r *= 1.01; } // curiosity rises
      else if (s.endsWith('!')) { p += 0.06 * expr; r *= 1.05; } // energy
      else if (/[:—–,]$/.test(s)) { p -= 0.02 * expr; }      // settle before a beat
      u.pitch = Math.min(1.6, Math.max(0.5, p));
      u.rate = Math.min(1.8, Math.max(0.6, r));
      u.volume = 1;
      u.onboundary = e => {
        if (e.charIndex == null || !cb.onword) return;
        cb.onword(offsets[si] + localWord(s, e.charIndex), words.length);
      };
      u.onend = () => next(si + 1, 0);
      // engine hiccups (synthesis-failed, network, audio-busy…) must NOT skip
      // the sentence — retry it up to 3 times before moving on
      u.onerror = e => {
        if (cancelled || e.error === 'interrupted' || e.error === 'canceled') return;
        if ((attempt || 0) < 3) setTimeout(() => next(si, (attempt || 0) + 1), 180);
        else next(si + 1, 0);
      };
      speechSynthesis.speak(u);
    };
    next(0, 0);
    return { cancel: () => { cancelled = true; try { speechSynthesis.cancel(); } catch (e) {} } };
  }

  SS.narrator = {
    estMs, speak,
    get muted() { return muted; },
    get rate() { return rate; },
    get baseRate() { return baseRate; },
    get expr() { return expr; },
    get voiceName() { return voiceName; },
    get voices() { return speechSynthesis.getVoices() || []; },
    isPremium(v) { return /natural|neural/i.test(v.name) || rank(v) < 8; },
    setVoice(uri) { SS.state.prefs.voiceURI = uri; SS.state.save(); pickVoice(); },
    setRate(r, persist = true) { rate = r; if (persist) { baseRate = r; SS.state.prefs.rate = r; SS.state.save(); } },
    setExpr(e) { expr = e; SS.state.prefs.expr = e; SS.state.save(); },
    setMuted(m) { muted = m; SS.state.prefs.muted = m; SS.state.save(); if (m) try { speechSynthesis.cancel(); } catch (e) {} },
    cancel() { try { speechSynthesis.cancel(); } catch (e) {} },
    /* speak a sample line with an arbitrary voice, without changing prefs */
    preview(v) {
      if (!('speechSynthesis' in window) || !v) return;
      try { speechSynthesis.cancel(); } catch (e) {}
      const samples = [
        "Here's the thing — tokens are the currency of every model you'll ever call.",
        "Watch what happens when the temperature drops to zero.",
        "This is where dot-net developers get bitten — the arguments arrive as a JSON string.",
        "Same idea as Dapper, three lines — and you're done."
      ];
      const u = new SpeechSynthesisUtterance(samples[Math.floor(Math.random() * samples.length)]);
      u.voice = v; u.lang = v.lang || 'en-US';
      u.rate = rate; u.pitch = 1; u.volume = 1;
      speechSynthesis.speak(u);
    },
    /* karaoke driver: returns stop(); calls onword over estimated timing */
    karaoke(text, onword) {
      const words = text.trim().split(/\s+/);
      const total = estMs(text) - 550;
      const t0 = performance.now();
      let raf, alive = true;
      const tick = now => {
        if (!alive) return;
        const i = Math.min(words.length - 1, Math.floor((now - t0) / total * words.length));
        onword(i, words.length);
        if (now - t0 < total) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { alive = false; cancelAnimationFrame(raf); };
    }
  };
})();
