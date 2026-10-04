/* SwipeScript AI — motion upgrade layer.
   Three independent upgrades, each with a graceful fallback if its library
   failed to load (or the user prefers reduced motion):
   1. transition()  — GSAP exit/enter tween between scenes (player calls it)
   2. attachBg()    — living canvas background (drifting accent blobs + pollen)
   3. hookFX()      — Lottie pulse accent behind the hook card            */
(function () {
  const SS = window.SS = window.SS || {};
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LIN = { i: { x: [0.5], y: [0.5] }, o: { x: [0.5], y: [0.5] } };   // linear keyframe pair
  const EASE = { i: { x: [0.33], y: [1] }, o: { x: [0.33], y: [0] } };    // ease-out pair

  /* ================= 1. scene exit/enter transition ================= */
  function transition(stage, oldLayers, newMount) {
    if (!window.gsap) { if (oldLayers) oldLayers.forEach(l => l.remove()); return; }
    if (oldLayers && oldLayers.length) {
      // old scene lifts out with a soft blur while the new one springs in
      gsap.to(oldLayers, {
        opacity: 0, y: -26, scale: 0.95,
        duration: 0.25, ease: 'power2.in',
        onComplete: () => oldLayers.forEach(l => l.remove())
      });
      gsap.fromTo(newMount,
        { opacity: 0, y: 42, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.35)', delay: 0.1 });
    } else {
      gsap.fromTo(newMount,
        { opacity: 0, y: 26, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.35)' });
    }
  }

  /* ================= 2. living background ================= */
  function attachBg(reelEl) {
    const host = reelEl.querySelector('.reel-bg');
    if (!host || host.querySelector('canvas.bg-fx')) return () => {};
    const cv = document.createElement('canvas');
    cv.className = 'bg-fx';
    cv.setAttribute('aria-hidden', 'true');
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0, raf = 0, live = false, t = Math.random() * 100;

    const FALLBACK = { python: [245, 158, 11], genai: [101, 163, 13], agentic: [13, 148, 136] };
    const accentOf = () => {
      const raw = getComputedStyle(reelEl).getPropertyValue('--accent').trim();
      const m = raw.match(/^#([0-9a-f]{6})$/i);
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
      return FALLBACK[reelEl.dataset.section] || FALLBACK.genai;
    };
    let accent = accentOf();

    // slow-floating soft wash blobs (fractional anchor points, radius vs min edge)
    const blobs = [0.18, 0.82, 0.5, 0.32].map((fx, i) => ({
      fx, fy: [0.22, 0.68, 0.92, 0.45][i],
      r: [0.46, 0.52, 0.4, 0.32][i],
      sp: 0.22 + i * 0.06, ph: i * 1.7
    }));
    // tiny drifting "pollen" dots that rise and twinkle
    const dots = Array.from({ length: 14 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.8 + Math.random() * 1.8,
      v: 0.5 + Math.random() * 1.2,          // % of height per second
      ph: Math.random() * 6.28,
      a: 0.10 + Math.random() * 0.16
    }));

    const size = () => {
      const w = host.clientWidth, hh = host.clientHeight;
      if (w && hh && (w !== W || hh !== H)) {
        W = w; H = hh;
        cv.width = W * dpr; cv.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const draw = () => {
      size();
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      const [r, g, b] = accent;
      for (const bl of blobs) {
        const x = (bl.fx + Math.sin(t * bl.sp + bl.ph) * 0.09) * W;
        const y = (bl.fy + Math.cos(t * bl.sp * 0.8 + bl.ph) * 0.08) * H;
        const rad = bl.r * Math.min(W, H) * (1 + 0.12 * Math.sin(t * 0.6 + bl.ph));
        const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, rad));
        grad.addColorStop(0, `rgba(${r},${g},${b},0.09)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      for (const d of dots) {
        d.y -= (d.v / 100) * 0.016;                    // advance ~per frame
        if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
        const tw = 0.5 + 0.5 * Math.sin(t * 1.4 + d.ph);
        ctx.beginPath();
        ctx.arc(d.x * W + Math.sin(t * 0.5 + d.ph) * 6, d.y * H, d.r, 0, 6.283);
        ctx.fillStyle = `rgba(${r},${g},${b},${(d.a * tw).toFixed(3)})`;
        ctx.fill();
      }
    };

    const step = () => { if (!live) return; t += 0.016; draw(); raf = requestAnimationFrame(step); };
    const start = () => { if (live || reduced()) return; live = true; raf = requestAnimationFrame(step); };
    const halt = () => { live = false; cancelAnimationFrame(raf); };
    if (reduced()) draw();                            // one static frame, no motion
    const io = new IntersectionObserver(es =>
      es.forEach(en => (en.intersectionRatio >= 0.5 ? start() : halt())), { threshold: [0, 0.5, 1] });
    io.observe(reelEl);
    return () => { halt(); io.disconnect(); cv.remove(); };
  }

  /* ================= 3. Lottie hook accent ================= */
  /* Hand-authored 200×200 loop (2s): expanding ripple ring, three pale dots
     orbiting a pulsing core. Core/ripple take the reel's section accent.   */
  const AMBER = [0.961, 0.620, 0.043, 1];   // #f59e0b (fallback)
  const PALE = [1, 1, 1, 1];                // orbiting dots stay white-ish
  const hex2rgb = hex => {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255, 1] : AMBER;
  };
  const tr = (x, y) => ({ ty: 'tr', p: { a: 0, k: [x, y] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
  const dot = (x, y) => ({
    ty: 'gr', it: [
      { d: 1, ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [15, 15] } },
      { ty: 'fl', c: { a: 0, k: PALE }, o: { a: 0, k: 100 } },
      tr(x, y)
    ]
  });
  const buildAnim = core => ({
    v: '5.5.2', fr: 60, ip: 0, op: 120, w: 200, h: 200, nm: 'playschool-pulse', ddd: 0, assets: [],
    layers: [
      { // ripple ring — expands & fades twice per loop
        ddd: 0, ind: 1, ty: 4, nm: 'ripple', sr: 1, ip: 0, op: 120, st: 0, ao: 0,
        ks: {
          o: { a: 1, k: [
            { ...LIN, t: 0, s: [55] }, { ...LIN, t: 60, s: [0] },
            { ...LIN, t: 61, s: [55] }, { ...LIN, t: 120, s: [0] }
          ] },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [100, 100, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 1, k: [
            { ...LIN, t: 0, s: [62, 62, 100] }, { ...LIN, t: 60, s: [150, 150, 100] },
            { ...LIN, t: 61, s: [62, 62, 100] }, { ...LIN, t: 120, s: [150, 150, 100] }
          ] }
        },
        shapes: [{
          ty: 'gr', nm: 'ring', ix: 1,
          it: [
            { d: 1, ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [120, 120] } },
            { ty: 'st', c: { a: 0, k: core }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 }, lc: 2, lj: 2 },
            tr(0, 0)
          ]
        }]
      },
      { // three amber dots orbiting the core
        ddd: 0, ind: 2, ty: 4, nm: 'orbit', sr: 1, ip: 0, op: 120, st: 0, ao: 0,
        ks: {
          o: { a: 0, k: 90 },
          r: { a: 1, k: [{ ...EASE, t: 0, s: [0] }, { ...EASE, t: 120, s: [360] }] },
          p: { a: 0, k: [100, 100, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] }
        },
        shapes: [dot(46, 0), dot(-23, 39.8), dot(-23, -39.8)]
      },
      { // pulsing core
        ddd: 0, ind: 3, ty: 4, nm: 'core', sr: 1, ip: 0, op: 120, st: 0, ao: 0,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [100, 100, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 1, k: [
            { ...EASE, t: 0, s: [100, 100, 100] }, { ...EASE, t: 30, s: [114, 114, 100] },
            { ...EASE, t: 60, s: [100, 100, 100] }, { ...EASE, t: 90, s: [114, 114, 100] },
            { ...EASE, t: 120, s: [100, 100, 100] }
          ] }
        },
        shapes: [{
          ty: 'gr', nm: 'disc', ix: 1,
          it: [
            { d: 1, ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [58, 58] } },
            { ty: 'fl', c: { a: 0, k: core }, o: { a: 0, k: 100 } },
            tr(0, 0)
          ]
        }]
      }
    ]
  });

  function hookFX(hookEl) {
    if (!window.lottie || hookEl.querySelector('.hook-lottie')) return null;
    let anim = null;
    const box = document.createElement('div');
    box.className = 'hook-lottie';
    try {
      // tint core + ripple with the reel's section accent (falls back to amber)
      const reel = hookEl.closest('.reel');
      const raw = reel ? getComputedStyle(reel).getPropertyValue('--accent-deep').trim() : '';
      hookEl.appendChild(box);
      anim = window.lottie.loadAnimation({
        container: box, renderer: 'svg', loop: true, autoplay: true, animationData: buildAnim(hex2rgb(raw || '#b45309'))
      });
      return () => { try { anim.destroy(); } catch (e) {} box.remove(); };
    } catch (e) {
      try { anim && anim.destroy(); } catch (_) {}
      box.remove();
      return null;
    }
  }

  SS.motion = { transition, attachBg, hookFX };
})();
