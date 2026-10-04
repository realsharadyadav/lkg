/* SwipeScript AI — scene engine. Each renderer mounts into a .scene element and
   returns a cleanup function. Scene lifetime is narration-driven (player decides). */
(function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const mark = s => s.replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');

  /* split rendered HTML into per-word spans (keeps the **highlight** spans) so words can rise in one by one */
  const kinetic = html => {
    const box = document.createElement('div'); box.innerHTML = html;
    let n = 0;
    const walk = node => [...node.childNodes].forEach(c => {
      if (c.nodeType !== 3) { walk(c); return; }
      const frag = document.createDocumentFragment();
      c.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        const w = document.createElement('span'); w.className = 'w'; w.style.setProperty('--i', n++); w.textContent = part;
        frag.appendChild(w);
      });
      c.replaceWith(frag);
    });
    walk(box);
    return box.innerHTML;
  };
  window.SS = window.SS || {};
  window.SS.kinetic = kinetic;

  function base(mount) {
    mount.innerHTML = '';
    const el = h('div', 'scene-inner');
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;width:100%';
    mount.appendChild(el);
    return el;
  }
  const pop = (el, delay, cls) => { el.classList.add('pop'); if (delay) el.classList.add('d' + delay); if (cls) el.classList.add(cls); };

  const SS = window.SS;
  SS.scenes = {

    /* ---- bold statement ---- */
    bigtext(mount, sc) {
      const el = base(mount);
      if (sc.kicker) { const k = h('div', 'kicker', sc.kicker); el.appendChild(k); pop(k, 0); }
      const w = h('div', 'floaty'); w.style.width = '100%';
      const t = h('div', 'big-h', kinetic(mark(sc.title || '')));
      w.appendChild(t); el.appendChild(w); pop(t, 1);
      if (sc.sub) { const s = h('div', 'big-sub', mark(sc.sub)); el.appendChild(s); pop(s, 2); }
      return () => {};
    },

    /* ---- "next up" teaser ---- */
    bridge(mount, sc) {
      const el = base(mount);
      const k = h('div', 'kicker', sc.kicker || 'KEEP SWIPING'); el.appendChild(k); pop(k, 0);
      const w = h('div', 'floaty'); w.style.width = '100%';
      const t = h('div', 'big-h', kinetic(mark(sc.title || '')));
      w.appendChild(t); el.appendChild(w); pop(t, 1);
      if (sc.next) {
        const n = h('div', '', '▶&nbsp; ' + sc.next);
        n.style.cssText = 'margin-top:10px;font-size:12.5px;font-weight:900;letter-spacing:.6px;color:var(--accent);background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);padding:8px 16px;border-radius:999px;opacity:0';
        el.appendChild(n); pop(n, 3);
      }
      return () => {};
    },

    /* ---- list cards ---- */
    list(mount, sc, ctx) {
      const el = base(mount);
      const card = h('div', 'list-card');
      el.appendChild(card);
      (sc.items || []).forEach((it, i) => {
        const d = h('div', 'list-item', `<span class="dot">${it.e || '•'}</span><span><b>${mark(it.t)}</b>${it.s ? `<small>${mark(it.s)}</small>` : ''}</span>`);
        card.appendChild(d); pop(d, 0); d.style.animationDelay = Math.min(1.2, 0.1 + i * 0.14) + 's';
      });
      // sequential highlight — the narration "walks through" the items one by one
      let dead = false, iv = null;
      const kids = [...card.children];
      const durMs = ctx && ctx.durMs;
      if (durMs && kids.length > 1) {
        const stepMs = Math.max(2000, durMs / kids.length);
        let i = 0;
        iv = setInterval(() => {
          if (dead) return;
          kids.forEach((k, j) => k.classList.toggle('hot', j === i % kids.length));
          i++;
        }, stepMs);
      }
      return () => { dead = true; clearInterval(iv); };
    },

    /* ---- compare cards (2 side by side with VS; 3-4 in a grid) ---- */
    compare(mount, sc) {
      const el = base(mount);
      const cards = sc.cards || [];
      const row = h('div', 'compare' + (cards.length > 2 ? ' multi' : ''));
      el.appendChild(row);
      cards.forEach((c, i) => {
        const d = h('div', 'cmp-card' + (c.win ? ' win' : ''), `<div class="em">${c.e}</div><h3>${mark(c.t)}</h3><p>${mark(c.s)}</p>`);
        row.appendChild(d); pop(d, Math.min(i, 4), cards.length > 2 ? '' : (i ? 'from-r' : 'from-l'));
      });
      if (cards.length === 2) { const vs = h('div', 'vs', 'VS'); row.insertBefore(vs, row.children[1]); pop(vs, 2); }
      return () => {};
    },

    /* ---- predict-the-next-token ---- */
    tokens(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'tokens-wrap');
      const row = h('div', 'token-row');
      const node = h('div', 'model-node', `<span>LLM<small>NEXT-WORD GUESSER</small></span><span class="orbit"></span>`);
      const probs = h('div', 'prob-list');
      el.appendChild(wrap); wrap.appendChild(row);
      const fl = h('div', 'flowline', 'reads the text ↓ makes one guess');
      wrap.appendChild(fl); wrap.appendChild(node); wrap.appendChild(probs);

      let dead = false, anims = [];
      const kill = () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };

      (async () => {
        const examples = sc.examples || [{ words: sc.words || ['The', 'cat', 'sat', 'on', 'the'], cands: sc.cands || [{ w: 'mat', p: 72 }, { w: 'moon', p: 14 }, { w: 'rug', p: 9 }] }];
        let guard = 0;
        while (!dead && guard++ < 12) {
          for (const ex of examples) {
            if (dead) return;
            row.innerHTML = ''; probs.innerHTML = '';
            // 1. tokens pop in
            for (const w of ex.words) {
              if (dead) return;
              const t = h('span', 'tok', w);
              row.appendChild(t);
              anims.push(t.animate([{ opacity: 0, transform: 'translateY(16px) scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'forwards' }));
              await sleep(330);
            }
            // 2. read-highlight sweep
            const toks = [...row.children];
            for (const t of toks) {
              if (dead) return;
            anims.push(t.animate([{ boxShadow: '0 0 0 rgba(0,0,0,0)' }, { boxShadow: '0 0 18px currentColor', backgroundColor: 'rgba(101,163,13,.16)' }, { boxShadow: '0 0 0 rgba(0,0,0,0)' }], { duration: 300 }));
              await sleep(190);
            }
            // 3. mask token
            const mask = h('span', 'tok mask', '___?');
            row.appendChild(mask);
            anims.push(mask.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, fill: 'forwards', easing: 'ease-out' }));
            await sleep(650);
            // 4. probability bars
            const win = ex.cands.reduce((a, b) => (b.p > a.p ? b : a));
            for (const c of ex.cands) {
              if (dead) return;
              const p = h('div', 'prob' + (c === win ? ' win' : ''), `<span class="pw">${c.w}</span><span class="bar"><i></i></span><span class="pc">${c.p}%</span>`);
              probs.appendChild(p);
              anims.push(p.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 300, fill: 'forwards' }));
              requestAnimationFrame(() => requestAnimationFrame(() => { p.querySelector('i').style.width = c.p + '%'; }));
              await sleep(260);
            }
            await sleep(950);
            // 5. winner fills the blank
            if (dead) return;
            mask.textContent = win.w;
            mask.classList.remove('mask');
            mask.style.color = 'var(--accent-deep)';
            mask.style.borderColor = 'var(--accent)';
            mask.style.background = 'var(--accent-soft)';
            anims.push(mask.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' }));
            [...probs.children].forEach(p => { if (!p.classList.contains('win')) p.style.opacity = .3; });
            await sleep(2100);
            if (!sc.loop) return;
            // fade out for next example
            anims.push(row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }));
            anims.push(probs.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }));
            await sleep(380);
            row.style.opacity = 1; probs.style.opacity = 1;
          }
        }
      })();
      return kill;
    },

    /* ---- embedding vector space ---- */
    vector(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'vspace');
      const plane = h('div', 'vplane');
      wrap.appendChild(plane); el.appendChild(wrap);
      let dead = false, anims = [];
      const kill = () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
      const byName = {};

      (async () => {
        anims.push(plane.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 450, fill: 'forwards' }));
        await sleep(300);
        for (const p of sc.points || []) {
          if (dead) return;
          const d = h('div', 'vdot' + (p.hi ? ' hi' : ''), `<span class="p"></span><span class="n">${p.n}</span>`);
          d.style.left = p.x + '%'; d.style.top = p.y + '%';
          if (p.c) { d.style.setProperty('--dc', p.c); d.querySelector('.p').style.background = p.c; d.querySelector('.p').style.boxShadow = `0 0 14px ${p.c}`; }
          plane.appendChild(d); byName[p.n] = d;
          anims.push(d.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 380, fill: 'forwards', easing: 'cubic-bezier(.2,1.4,.4,1)' }));
          anims.push(d.animate([{ marginTop: '0px' }, { marginTop: '-5px' }, { marginTop: '0px' }], { duration: 2600 + Math.random() * 1200, iterations: Infinity }));
          await sleep(340);
        }
        await sleep(650);
        for (const pr of sc.pairs || []) {
          if (dead || !byName[pr.a] || !byName[pr.b]) continue;
          const rect = plane.getBoundingClientRect();
          const ax = byName[pr.a].offsetLeft, ay = byName[pr.a].offsetTop;
          const bx = byName[pr.b].offsetLeft, by = byName[pr.b].offsetTop;
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy);
          const line = h('div', 'vline');
          line.style.cssText += `left:${ax}px;top:${ay}px;width:${len}px;transform:rotate(${Math.atan2(dy, dx)}rad) scaleX(0);background:${pr.color || '#4ade80'};box-shadow:0 0 10px ${pr.color || '#4ade80'}`;
          plane.appendChild(line);
          anims.push(line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' }));
          line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
          line.style.transition = 'transform .8s cubic-bezier(.2,.9,.3,1)';
          requestAnimationFrame(() => requestAnimationFrame(() => { line.style.transform = `rotate(${Math.atan2(dy, dx)}rad) scaleX(1)`; }));
          if (pr.tag) {
            const tag = h('div', 'vtag', pr.tag);
            tag.style.cssText += `left:${(ax + bx) / 2}px;top:${(ay + by) / 2 - 16}px;color:${pr.color || '#4ade80'};background:rgba(255,255,255,.93);border:1px solid ${pr.color || '#4ade80'};box-shadow:0 2px 10px rgba(53,88,52,.2)`;
            plane.appendChild(tag);
            anims.push(tag.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 380, delay: 620, fill: 'forwards', easing: 'cubic-bezier(.2,1.5,.4,1)' }));
          }
          await sleep(1250);
        }
      })();
      return kill;
    },

    /* ---- word -> numbers ---- */
    embednums(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'embed-wrap');
      const eq = h('div', 'embed-eq');
      const word = h('div', 'embed-word', sc.word || 'cat');
      const arrow = h('div', 'embed-arrow', '➜');
      const vec = h('div', 'embed-vec');
      eq.appendChild(word); eq.appendChild(arrow); eq.appendChild(vec);
      const dims = h('div', 'embed-dims');
      wrap.appendChild(eq); wrap.appendChild(dims); el.appendChild(wrap);
      let dead = false, anims = [], iv;
      const vals = sc.vals || ['0.21', '-0.83', '0.47', '0.05', '-0.62', '0.91', '-0.14'];
      (async () => {
        pop(word, 0);
        await sleep(420);
        for (const v of vals) {
          if (dead) return;
          const c = h('span', 'dim-chip', v);
          vec.appendChild(c);
          anims.push(c.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, fill: 'forwards' }));
          await sleep(140);
        }
        const more = h('span', 'dim-chip', '···');
        vec.appendChild(more);
        anims.push(more.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' }));
        await sleep(350);
        const gold = h('span', 'dim-chip gold', sc.dims || '×1,536');
        vec.appendChild(gold);
        anims.push(gold.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, fill: 'forwards', easing: 'cubic-bezier(.2,1.6,.4,1)' }));
        await sleep(300);
        const target = sc.countTo || 1536;
        const t0 = performance.now(), dur = 1300;
        const step = now => {
          if (dead) return;
          const k = Math.min(1, (now - t0) / dur);
          dims.innerHTML = `a point in <b>${Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString()}</b> dimensions`;
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      })();
      return () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
    },

    /* ---- agent sense-think-act loop ---- */
    loop(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'loop-wrap');
      const ring = h('div', 'loop-ring');
      const core = h('div', 'loop-core', `<span>💭 THINK<small>LLM BRAIN</small></span>`);
      const obs = h('div', 'loop-node', `<span class="e">👁️</span>OBSERVE`);
      obs.style.cssText += 'left:50%;top:0;transform:translateX(-50%)';
      const act = h('div', 'loop-node', `<span class="e">🛠️</span>ACT`);
      act.style.cssText += 'right:-4%;bottom:6%';
      const goal = h('div', 'loop-node', `<span class="e">🎯</span>GOAL`);
      goal.style.cssText += 'left:-4%;bottom:6%';
      wrap.appendChild(ring); wrap.appendChild(obs); wrap.appendChild(act); wrap.appendChild(goal); wrap.appendChild(core);
      el.appendChild(wrap);
      let dead = false, anims = [];
      const kill = () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
      [obs, act, goal].forEach((n, i) => { anims.push(n.animate([{ opacity: 0, transform: n.style.transform + ' scale(.5)' }, { opacity: 1 }], { duration: 400, delay: i * 180, fill: 'forwards', easing: 'ease-out' })); });
      anims.push(core.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 450, fill: 'forwards', easing: 'cubic-bezier(.2,1.5,.4,1)' }));

      (async () => {
        await sleep(900);
        const chips = sc.chips && sc.chips.length ? sc.chips : ['🔍 search("tokyo flights")', '🏨 check_hotels()', '⭐ read_reviews()', '💰 total_price()'];
        let i = 0, guard = 0;
        while (!dead && guard++ < 14) {
          const setHot = n => { [obs, core, act].forEach(x => x.classList.remove('hot')); if (n) n.classList.add('hot'); };
          // observe
          setHot(obs); await sleep(750); if (dead) return;
          // chip to core
          let c = h('div', 'loop-chip', chips[i % chips.length]);
          wrap.appendChild(c);
          anims.push(c.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 240, fill: 'forwards' }));
          await sleep(620); if (dead) return;
          setHot(core);
          anims.push(core.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.12)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 520 }));
          await sleep(700); if (dead) return;
          // chip flies to act
          setHot(act);
          anims.push(c.animate([{ left: '50%', top: '50%' }, { left: '86%', top: '82%' }], { duration: 560, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'forwards' }));
          await sleep(640); if (dead) return;
          // result returns to observe
          c.textContent = '✓ result';
          setHot(obs);
          anims.push(c.animate([{ left: '86%', top: '82%' }, { left: '50%', top: '14%' }], { duration: 560, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'forwards' }));
          await sleep(620); if (dead) return;
          anims.push(c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }));
          setHot(null); i++;
        }
      })();
      return kill;
    },

    /* ---- chat bubbles ---- */
    chat(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'chat-wrap');
      el.appendChild(wrap);
      let dead = false, anims = [];
      (async () => {
        for (const b of sc.bubbles || []) {
          if (dead) return;
          const bubble = h('div', 'bubble ' + b.who, mark(b.text) + (b.tool ? `<br><span class="tool">🛠 ${b.tool}</span>` : ''));
          wrap.appendChild(bubble);
          anims.push(bubble.animate([{ opacity: 0, transform: 'translateY(14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 340, fill: 'forwards', easing: 'cubic-bezier(.2,1.3,.4,1)' }));
          await sleep(720);
        }
      })();
      return () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
    },

    /* ---- node chain diagram ---- */
    diagram(mount, sc) {
      const el = base(mount);
      const dia = h('div', 'diagram');
      el.appendChild(dia);
      let dead = false, anims = [], iv;
      (async () => {
        const nodes = sc.nodes || [];
        const row = h('div', 'dia-row');
        dia.appendChild(row);
        nodes.forEach((n, i) => {
          const d = h('div', 'dia-node', `<span class="e">${n.e || ''}</span>${mark(n.t)}${n.s ? `<small>${mark(n.s)}</small>` : ''}`);
          row.appendChild(d);
          anims.push(d.animate([{ opacity: 0, transform: 'translateY(18px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 200, fill: 'forwards', easing: 'cubic-bezier(.2,1.3,.4,1)' }));
          if (i < nodes.length - 1) {
            const link = h('div', 'dia-link', `<span class="lb">${sc.linkLabel || ''}</span><span class="stem"><i></i></span>`);
            row.appendChild(link);
            anims.push(link.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: i * 200 + 180, fill: 'forwards' }));
          }
        });
        if (sc.cycle) {
          await sleep(nodes.length * 200 + 700);
          let i = 0;
          iv = setInterval(() => {
            if (dead) return;
            [...row.querySelectorAll('.dia-node')].forEach((d, j) => d.classList.toggle('hot', j === i % nodes.length));
            i++;
          }, 1100);
        }
      })();
      return () => { dead = true; clearInterval(iv); anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
    },

    /* ---- layered architecture diagram (top → bottom stack) ---- */
    arch(mount, sc) {
      const el = base(mount);
      const stack = h('div', 'arch-stack');
      el.appendChild(stack);
      let dead = false, anims = [], iv;
      (async () => {
        const layers = sc.layers || [];
        layers.forEach((L, i) => {
          const card = h('div', 'arch-layer', `<span class="e">${L.e || '🧩'}</span><span class="tx"><b>${mark(L.t)}</b>${L.s ? `<small>${mark(L.s)}</small>` : ''}</span>`);
          stack.appendChild(card);
          anims.push(card.animate([{ opacity: 0, transform: 'translateY(-16px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 430, fill: 'forwards', easing: 'cubic-bezier(.2,1.3,.4,1)' }));
          if (i < layers.length - 1) {
            const link = h('div', 'arch-link-v', '<span class="stem"><i></i></span>');
            stack.appendChild(link);
            anims.push(link.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: i * 430 + 320, fill: 'forwards' }));
          }
        });
        if (sc.cycle !== false && layers.length) {
          await sleep(layers.length * 430 + 500);
          let i = 0;
          iv = setInterval(() => {
            if (dead) return;
            [...stack.querySelectorAll('.arch-layer')].forEach((d, j) => d.classList.toggle('hot', j === i % layers.length));
            i++;
          }, 1200);
        }
      })();
      return () => { dead = true; clearInterval(iv); anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
    },

    /* ---- spreadsheet diff + approval mock ---- */
    diffapprove(mount, sc) {
      const el = base(mount);
      const wrap = h('div', 'diff-wrap');
      const head = h('div', 'diff-head', `<span>📗 ${sc.sheet || 'Sheet1'}</span><span class="pill ${sc.verdict === 'approved' ? 'ok' : 'wait'}">${sc.verdict === 'approved' ? '✅ Approved' : '👤 Awaiting approval'}</span>`);
      const tbl = h('div', 'diff-table');
      tbl.appendChild(h('div', 'diff-row hd', '<span>Cell</span><span>Before</span><span></span><span>After</span><span>Rule</span>'));
      wrap.appendChild(head); wrap.appendChild(tbl); el.appendChild(wrap);
      let dead = false, anims = [];
      (async () => {
        for (const r of sc.rows || []) {
          if (dead) return;
          const row = h('div', 'diff-row', `<span class="cell">${r.cell}</span><span class="before">${r.before}</span><span class="arr">→</span><span class="after">${r.after}</span><span class="rule">${r.rule || ''}</span>`);
          tbl.appendChild(row);
          anims.push(row.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 300, fill: 'forwards' }));
          await sleep(480);
        }
      })();
      return () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
    },

    /* ---- pipeline: one packet travels stage to stage, changing shape as it goes ----
       {type:'flow', layers|stages:[{e,t,s,pk}]}  — pk is the emoji the packet becomes at that stage */
    flow(mount, sc) {
      const el = base(mount);
      const stages = sc.stages || sc.layers || sc.items || [];
      const wrap = h('div', 'fl-wrap');
      const track = h('div', 'fl-track', '<i></i>');
      const rows = stages.map(L => h('div', 'fl-row', `<span class="fl-node">${L.e || '•'}</span><span class="fl-tx"><b>${mark(L.t)}</b>${L.s ? `<small>${mark(L.s)}</small>` : ''}</span>`));
      const pkOf = i => (stages[i] && stages[i].pk) || '●';
      const pk = h('div', 'fl-pk', pkOf(0));
      wrap.appendChild(track); rows.forEach(r => wrap.appendChild(r)); wrap.appendChild(pk);
      el.appendChild(wrap);
      let dead = false, anims = [];
      const kill = () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
      if (!rows.length) return kill;
      rows.forEach((r, i) => { r.style.opacity = 0; anims.push(r.animate([{ opacity: 0, transform: 'translateX(-18px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 160, fill: 'forwards', easing: 'cubic-bezier(.2,1.3,.4,1)' })); });

      (async () => {
        await sleep(rows.length * 160 + 450);
        if (dead) return;
        const cy = r => r.offsetTop + r.offsetHeight / 2;
        const y0 = cy(rows[0]), span = Math.max(1, cy(rows[rows.length - 1]) - y0);
        track.style.top = y0 + 'px'; track.style.height = span + 'px';
        const fill = track.firstChild;
        for (let guard = 0; !dead && guard < 10; guard++) {
          rows.forEach(r => r.classList.remove('hot', 'done'));
          fill.style.transition = 'none'; fill.style.transform = 'scaleY(0)'; void fill.offsetWidth;
          pk.textContent = pkOf(0); pk.style.top = y0 + 'px';
          anims.push(pk.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 360, fill: 'forwards', easing: 'cubic-bezier(.2,1.5,.4,1)' }));
          rows[0].classList.add('hot');
          await sleep(900); if (dead) return;
          for (let i = 1; i < rows.length; i++) {
            const from = cy(rows[i - 1]), to = cy(rows[i]);
            pk.style.top = to + 'px';
            anims.push(pk.animate([{ top: from + 'px' }, { top: to + 'px' }], { duration: 540, easing: 'cubic-bezier(.45,.05,.3,1)' }));
            fill.style.transition = 'transform .54s cubic-bezier(.45,.05,.3,1)';
            fill.style.transform = `scaleY(${(to - y0) / span})`;
            await sleep(560); if (dead) return;
            rows[i - 1].classList.replace('hot', 'done');
            rows[i].classList.add('hot');
            pk.textContent = pkOf(i);
            anims.push(pk.animate([{ transform: 'translate(-50%,-50%) scale(1.5) rotate(-12deg)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.5,.4,1)' }));
            await sleep(820); if (dead) return;
          }
          rows[rows.length - 1].classList.replace('hot', 'done');
          await sleep(1500); if (dead) return;
          anims.push(pk.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));
          await sleep(350);
        }
      })();
      return kill;
    },

    /* ---- the same text cut by different chunking strategies ----
       {type:'chunks', title, text, strategies:[{name, e, cuts:[word index a chunk ENDS on]}]} */
    chunks(mount, sc) {
      const el = base(mount);
      if (sc.title) { const t = h('div', 'big-h sm', kinetic(mark(sc.title))); el.appendChild(t); pop(t, 0); }
      const card = h('div', 'ck-card');
      const tag = h('div', 'ck-tag', '&nbsp;');
      const body = h('div', 'ck-body');
      const verdict = h('div', 'ck-verdict', '&nbsp;');
      card.appendChild(tag); card.appendChild(body); card.appendChild(verdict);
      el.appendChild(card); pop(card, 1);
      const words = String(sc.text || '').split(/\s+/).filter(Boolean);
      const spans = words.map(w => { const s = h('span', 'ck-w', w); body.appendChild(s); body.appendChild(document.createTextNode(' ')); return s; });
      let dead = false;
      (async () => {
        await sleep(900);
        const sts = sc.strategies || [];
        for (let guard = 0; !dead && guard < 8; guard++) {
          for (const st of sts) {
            if (dead) return;
            spans.forEach(s => { s.className = 'ck-w'; });
            verdict.className = 'ck-verdict'; verdict.innerHTML = '&nbsp;';
            tag.innerHTML = `${st.e || ''} ${st.name}`;
            tag.classList.remove('swap'); void tag.offsetWidth; tag.classList.add('swap');
            const cuts = new Set(st.cuts || []);
            let k = 0, chunks = 1, bad = 0;
            await sleep(500);
            for (let i = 0; i < spans.length; i++) {
              if (dead) return;
              spans[i].classList.add('k' + (k % 4));
              await sleep(55);
              if (cuts.has(i) && i < spans.length - 1) {
                const mid = !/[.!?…]["'”’)]?$/.test(words[i]);
                spans[i].classList.add('cut'); if (mid) { spans[i].classList.add('bad'); bad++; }
                k++; chunks++;
                await sleep(mid ? 520 : 340);
              }
            }
            verdict.className = 'ck-verdict ' + (bad ? 'bad' : 'ok');
            verdict.textContent = bad ? `${chunks} chunks · ${bad} cut${bad > 1 ? 's' : ''} split a sentence ✗` : `${chunks} chunks · every cut lands on a boundary ✓`;
            await sleep(2300);
          }
        }
      })();
      return () => { dead = true; };
    },

    /* ---- sequential vs concurrent timeline (shared time axis) ----
       {type:'timeline', title, calls:5, callSec:2, lanes:[{name,note,limit}]}  limit = max calls in flight */
    timeline(mount, sc) {
      const el = base(mount);
      if (sc.kicker) { const k = h('div', 'kicker', sc.kicker); el.appendChild(k); pop(k, 0); }
      if (sc.title) { const t = h('div', 'big-h sm', kinetic(mark(sc.title))); el.appendChild(t); pop(t, 1); }
      const n = sc.calls || 5, sec = sc.callSec || 2, unit = sc.unitMs || 900;
      const wrap = h('div', 'tl-wrap');
      el.appendChild(wrap); pop(wrap, 2);
      const lanes = (sc.lanes || []).map(L => {
        const limit = Math.max(1, Math.min(n, L.limit || n));
        const lane = h('div', 'tl-lane' + (L.win ? ' win' : ''), `<div class="tl-head"><b>${L.name}</b><small>${L.note || ''}</small><span class="tl-clock">0.0 s</span></div>`);
        const grid = h('div', 'tl-grid');
        for (let r = 0; r < limit; r++) grid.appendChild(h('div', 'tl-row'));
        const bars = [];
        for (let i = 0; i < n; i++) {
          const col = Math.floor(i / limit);
          const b = h('i', 'tl-bar', `<em>${i + 1}</em>`);
          b.style.left = (col / n * 100) + '%'; b.style.width = (100 / n) + '%';
          grid.children[i % limit].appendChild(b);
          bars.push({ b, col });
        }
        lane.appendChild(grid); wrap.appendChild(lane);
        return { lane, bars, units: Math.ceil(n / limit), clock: lane.querySelector('.tl-clock') };
      });
      let dead = false, anims = [];
      const kill = () => { dead = true; anims.forEach(a => { try { a.cancel(); } catch (e) {} }); };
      (async () => {
        await sleep(900);
        for (let guard = 0; !dead && guard < 10; guard++) {
          anims.forEach(a => { try { a.cancel(); } catch (e) {} }); anims = [];
          lanes.forEach(L => { L.lane.classList.remove('done'); L.clock.textContent = '0.0 s'; L.bars.forEach(x => {
            x.b.style.opacity = 0;
            anims.push(x.b.animate([{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: unit, delay: x.col * unit, fill: 'forwards', easing: 'cubic-bezier(.3,.7,.4,1)' }));
          }); });
          const t0 = performance.now(), total = n * unit + 2400;
          await new Promise(res => {
            const step = now => {
              if (dead) return res();
              const e = now - t0;
              lanes.forEach(L => {
                const u = Math.min(L.units, e / unit);
                L.clock.textContent = (u * sec).toFixed(1) + ' s';
                if (u >= L.units) L.lane.classList.add('done');
              });
              if (e >= total) return res();
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          });
        }
      })();
      return kill;
    }
  };
})();
