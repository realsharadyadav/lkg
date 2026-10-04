/* LKG — on-device state: progress, likes, streak, prefs, resume point */
(function () {
  const KEY = 'lkg_v1';
  const blank = () => ({
    completed: {}, likes: {}, xp: 0,
    streak: { last: null, count: 0 },
    prefs: { muted: false, rate: 1.05, voiceURI: null, expr: 0.6, speed: 1, textSize: 'm', autonext: true, reduceMotion: false },
    last: { reel: null, at: null }
  });

  let data = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); data = { ...blank(), ...p, prefs: { ...blank().prefs, ...(p.prefs || {}) }, streak: { ...blank().streak, ...(p.streak || {}) }, last: { ...blank().last, ...(p.last || {}) } }; }
  } catch (e) { /* fresh start */ }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };
  const today = () => new Date().toISOString().slice(0, 10);

  function touchStreak() {
    const t = today(), s = data.streak;
    if (s.last === t) return s.count;
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    s.count = (s.last === y) ? s.count + 1 : 1;
    s.last = t; save();
    return s.count;
  }

  let resumeUsed = false;
  window.SS = window.SS || {};
  SS.state = {
    get prefs() { return data.prefs; },
    save,
    isCompleted: id => !!data.completed[id],
    markCompleted(id) { data.completed[id] = Date.now(); touchStreak(); save(); },
    isLiked: id => !!data.likes[id],
    toggleLike(id) { data.likes[id] = !data.likes[id]; if (!data.likes[id]) delete data.likes[id]; save(); return !!data.likes[id]; },
    completedCount: ids => ids.filter(id => data.completed[id]).length,
    streak: () => data.streak.count,
    getLastReel: () => (data.last && data.last.reel) || null,
    setLastReel(id) { data.last.reel = id; save(); },
    xp: () => data.xp || 0,
    addXp(n) { data.xp = (data.xp || 0) + n; save(); return data.xp; },
    /* exact-scene resume: remember {id, idx}; the first player started after a load may consume it */
    setScene(id, idx) { data.last.at = { id, idx }; save(); },
    clearScene() { data.last.at = null; save(); },
    takeResume(id) {
      if (resumeUsed) return 0;
      resumeUsed = true;
      const a = data.last.at;
      return a && a.id === id ? a.idx : 0;
    },
    reset() { data = blank(); save(); }
  };
})();
