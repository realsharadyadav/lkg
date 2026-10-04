#!/usr/bin/env node
/* Static check for `story` scenes — no browser, no screenshots.
     node scripts/check-story.js [PY-02 PY-03 ...]     (no args = every reel)
   Catches: cue phrases missing from the narration, bad ops / unknown ids, actors that fall off the stage,
   actors overlapping while visible together (simulated step by step), text wider than its container,
   and any change to the original narration / scene order (compared with git HEAD). Exit 1 on errors. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const STAGE_W = 292;                                   // real stage width on a 360px phone (~0.81 x viewport); 316 on 390, 348 on 430 — design for the smallest
const OPS = { show: 2, hide: 2, hot: 2, unhot: 2, dim: 2, undim: 2, tone: 3, text: 3, move: 4, pulse: 2 };
const TONES = ['good', 'bad', 'accent', 'dashed', ''];
const KINDS = ['panel', 'chip', 'pkg', 'tag', 'term'];
const CONTAINERS = ['panel', 'term'];

const args = process.argv.slice(2);
const files = (args.length ? args.map(a => a.replace(/\.json$/, '') + '.json') : fs.readdirSync(path.join(root, 'data/reels')).filter(f => f.endsWith('.json')).sort());
let errors = 0, warns = 0, stories = 0;
const err = (id, i, m) => { errors++; console.log(`ERROR ${id} scene ${i}: ${m}`); };
const warn = (id, i, m) => { warns++; console.log(`warn  ${id} scene ${i}: ${m}`); };

/* rough rendered size in px of an actor, from the CSS in app.css */
function size(a, H) {
  const t = (a.t || '').replace(/\*\*/g, ''), c = (a.c || '').split(' ');
  if (a.k === 'pkg') return [38, 38];
  if (a.k === 'chip') { const sm = c.includes('sm'); return [t.length * (sm ? 6.2 : 7.0) + (a.e ? (sm ? 20 : 24) : 0) + (sm ? 22 : 26), sm ? 28 : 34]; }
  if (a.k === 'tag') return [t.length * 5.8 + (a.e ? 18 : 0) + 24, 24];
  return [(a.w || 30) / 100 * STAGE_W, (a.h || 30) / 100 * H];   // panel / term
}
const box = (a, pos, H) => { const [w, h] = size(a, H), x = pos.x / 100 * STAGE_W, y = pos.y / 100 * H; return { l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2, w, h }; };
const hit = (p, q, m = 2) => p.l < q.r - m && q.l < p.r - m && p.t < q.b - m && q.t < p.b - m;
const inside = (p, q) => p.l >= q.l - 2 && p.r <= q.r + 2 && p.t >= q.t - 2 && p.b <= q.b + 2;

for (const f of files) {
  const id = f.replace('.json', '');
  const fp = path.join(root, 'data/reels', f);
  if (!fs.existsSync(fp)) { console.log(`ERROR ${id}: no such reel`); errors++; continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let base = null;
  try { base = JSON.parse(cp.execSync(`git show HEAD:data/reels/${f}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch (e) {}
  if (base) {
    if (base.scenes.length !== d.scenes.length) err(id, '-', `scene count changed ${base.scenes.length} -> ${d.scenes.length} (audio is keyed by scene index)`);
    base.scenes.forEach((b, i) => {
      const s = d.scenes[i]; if (!s) return;
      if ((b.narration || '') !== (s.narration || '')) err(id, i, 'narration text changed — it must stay byte-for-byte (audio clip would no longer match)');
      if (b.chapter !== s.chapter) err(id, i, 'chapter changed');
    });
    ['hook', 'recap', 'quiz', 'chapters'].forEach(k => { if (JSON.stringify(base[k]) !== JSON.stringify(d[k])) err(id, '-', `"${k}" changed`); });
  }
  d.scenes.forEach((sc, i) => {
    if (sc.type !== 'story') return;
    stories++;
    const H = sc.h || 280, actors = sc.actors || [], steps = sc.steps || [];
    if (!sc.narration) err(id, i, 'story scene without narration');
    if (!actors.length || !steps.length) err(id, i, 'needs actors and steps');
    const A = {};
    actors.forEach(a => {
      if (!a.id) return err(id, i, 'actor without id');
      if (A[a.id]) err(id, i, `duplicate actor id "${a.id}"`);
      A[a.id] = a;
      if (!KINDS.includes(a.k)) err(id, i, `actor ${a.id}: unknown kind "${a.k}"`);
      if (typeof a.x !== 'number' || typeof a.y !== 'number') err(id, i, `actor ${a.id}: x,y must be numbers (% of stage)`);
      if (a.tone != null && !TONES.includes(a.tone)) err(id, i, `actor ${a.id}: unknown tone "${a.tone}"`);
      if ((a.k === 'panel' || a.k === 'term') && (!a.w || !a.h)) warn(id, i, `actor ${a.id}: ${a.k} needs w and h`);
    });
    const narr = sc.narration.replace(/\*/g, '').toLowerCase();
    let last = -1;
    steps.forEach((s, n) => {
      if (typeof s.at === 'string') {
        const ix = narr.indexOf(s.at.toLowerCase());
        if (ix < 0) err(id, i, `step ${n}: phrase not found in narration: "${s.at}"`);
        else { if (ix < last) warn(id, i, `step ${n}: cue "${s.at}" is earlier in the narration than the previous step (steps run in narration order)`); last = ix; }
      } else if (typeof s.at !== 'number') err(id, i, `step ${n}: "at" must be a phrase string`);
      (s.do || []).forEach(op => {
        if (!Array.isArray(op) || !(op[0] in OPS)) return err(id, i, `step ${n}: bad op ${JSON.stringify(op)}`);
        if (op.length !== OPS[op[0]]) err(id, i, `step ${n}: op ${op[0]} takes ${OPS[op[0]] - 1} args: ${JSON.stringify(op)}`);
        if (!A[op[1]]) err(id, i, `step ${n}: op ${op[0]} refers to unknown actor "${op[1]}"`);
        if (op[0] === 'tone' && !TONES.includes(op[2])) err(id, i, `step ${n}: unknown tone "${op[2]}"`);
        if (op[0] === 'move' && (typeof op[2] !== 'number' || typeof op[3] !== 'number')) err(id, i, `step ${n}: move needs numeric x,y`);
      });
    });
    if (!actors.every(a => A[a.id])) return;
    // simulate every state: who is visible and where
    const pos = {}, vis = new Set(), seen = new Set();
    const reset = () => { vis.clear(); actors.forEach(a => { pos[a.id] = { x: a.x, y: a.y }; if (a.on) vis.add(a.id); }); };
    reset();
    const everVisible = new Set(vis);
    const check = label => {
      const ids = [...vis];
      ids.forEach(x => {
        const a = A[x], b = box(a, pos[x], H);
        if (b.l < -1 || b.r > STAGE_W + 1 || b.t < -1 || b.b > H + 1) { const k = `off${x}`; if (!seen.has(k)) { seen.add(k); err(id, i, `${label}: "${x}" falls outside the stage (${Math.round(b.l)}..${Math.round(b.r)}px of ${STAGE_W}, ${Math.round(b.t)}..${Math.round(b.b)}px of ${H})`); } }
      });
      for (let p = 0; p < ids.length; p++) for (let q = p + 1; q < ids.length; q++) {
        const a = A[ids[p]], b = A[ids[q]], ba = box(a, pos[a.id], H), bb = box(b, pos[b.id], H);
        const ca = CONTAINERS.includes(a.k), cb = CONTAINERS.includes(b.k);
        if (!hit(ba, bb)) continue;
        if (ca !== cb) { const inner = ca ? bb : ba, outer = ca ? ba : bb; if (inside(inner, outer)) continue; }   // child inside its container is fine
        const k = `ov${ids[p]}|${ids[q]}`; if (seen.has(k)) continue; seen.add(k);
        err(id, i, `${label}: "${a.id}" overlaps "${b.id}" while both are visible`);
      }
    };
    const widthCheck = () => actors.forEach(a => {
      if (a.k === 'chip' || a.k === 'tag') {                // a chip/tag that sits inside a container must fit in it
        const b = box(a, { x: a.x, y: a.y }, H);
        actors.filter(c => CONTAINERS.includes(c.k)).forEach(c => { const cb = box(c, { x: c.x, y: c.y }, H); if (b.l > cb.l && b.r < cb.r + b.w && b.t > cb.t && b.b < cb.b && b.r > cb.r + 2) warn(id, i, `"${a.id}" is wider than its container "${c.id}"`); });
      }
    });
    widthCheck();
    check('initial');
    steps.slice().sort((p, q) => (typeof p.at === 'string' ? narr.indexOf(p.at.toLowerCase()) : p.at * narr.length) - (typeof q.at === 'string' ? narr.indexOf(q.at.toLowerCase()) : q.at * narr.length)).forEach((s, n) => {
      (s.do || []).forEach(op => {
        const k = op[1];
        if (op[0] === 'show') { vis.add(k); everVisible.add(k); } else if (op[0] === 'hide') vis.delete(k);
        else if (op[0] === 'move' && pos[k]) pos[k] = { x: op[2], y: op[3] };
      });
      check(`after step ${n} ("${s.at}")`);
    });
    actors.forEach(a => { if (!everVisible.has(a.id)) warn(id, i, `actor "${a.id}" is never shown`); });
    const used = new Set(); steps.forEach(s => (s.do || []).forEach(o => used.add(o[1])));
    if (steps[0] && typeof steps[0].at === 'string' && narr.indexOf(steps[0].at.toLowerCase()) > narr.length * 0.15) warn(id, i, 'first step starts late — the stage is empty for the first part of the narration');
  });
}
console.log(`\n${stories} story scene(s) checked — ${errors} error(s), ${warns} warning(s)`);
process.exit(errors ? 1 : 0);
