/* Smoke test: node tests/smoke.js   (needs `playwright` + a Chromium; set CHROMIUM=/path if needed)
   Serves the repo statically and drives the real app in a phone-sized browser. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, b) => {
    if (e) { r.writeHead(404); r.end(); return; }
    const h = { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || '');   // media needs Range support, like a real host
    if (m) { const s = +m[1], e2 = m[2] ? +m[2] : b.length - 1; r.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e2}/${b.length}`, 'Content-Length': e2 - s + 1 }); r.end(b.slice(s, e2 + 1)); }
    else { r.writeHead(200, { ...h, 'Content-Length': b.length }); r.end(b); }
  });
});
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(1500);
  await p.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = document.querySelectorAll('.reel')[1].offsetTop; });
  await p.waitForTimeout(600);
  await p.mouse.click(195, 400);               // unlock audio + start
  await p.waitForTimeout(3900);                // past the old 3.6s hard cut-off
  ok(await p.evaluate(() => SS.feed.activePlayer().state === 'hook'), 'hook still playing after 3.9s (no early cut)');
  await p.waitForFunction(() => SS.feed.activePlayer().state === 'scene', null, { timeout: 25000 });
  ok(true, 'moves to scenes after hook audio ends');
  // click an element of the reel that is on screen (other reels have the same buttons)
  const tapActive = async sel => {
    const r = await p.evaluate(s => { const b = SS.feed.activePlayer().root.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
    await p.mouse.click(r.x, r.y);
  };
  const frac = () => p.evaluate(() => parseFloat(SS.feed.activePlayer().audBar.firstChild.style.transform.replace(/[^0-9.]/g, '')));
  await p.waitForTimeout(1500);
  const f1 = await frac(); ok(f1 > 0, 'audio progress bar advances (' + f1.toFixed(2) + ')');
  await p.mouse.click(195, 300); await p.waitForTimeout(150);
  ok(await p.evaluate(() => SS.feed.activePlayer().paused), 'tap pauses within 150ms');
  const fp = await frac(); await p.waitForTimeout(800);
  ok(Math.abs((await frac()) - fp) < 0.01, 'bar frozen while paused');
  await p.mouse.click(195, 300); await p.waitForTimeout(150);
  const r0 = await frac(); await p.waitForTimeout(1000); const r1 = await frac();
  ok(r0 < fp && r1 > r0, 'resume replays the last ~2s then continues (' + fp.toFixed(2) + ' -> ' + r0.toFixed(2) + ' -> ' + r1.toFixed(2) + ')');
  await tapActive('.rail-code'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => SS.feed.activePlayer().paused), 'opening code pauses');
  await p.click('#codePanel .close-sheet'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !SS.feed.activePlayer().paused), 'closing code resumes');
  await tapActive('.rail-mute'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => [...document.querySelectorAll('audio')].length === 0 && SS.narrator.muted), 'mute toggles on');
  await tapActive('.rail-mute'); await p.waitForTimeout(200);
  // horizontal swipes: left -> code, right -> notes
  const swipe = async (x0, x1) => { await p.mouse.move(x0, 420); await p.mouse.down(); for (let k = 1; k <= 8; k++) await p.mouse.move(x0 + (x1 - x0) * k / 8, 420); await p.mouse.up(); };
  await swipe(300, 120); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.querySelector('#codePanel').classList.contains('open')), 'swipe left opens code');
  await p.click('#codePanel .close-sheet'); await p.waitForTimeout(500);
  await swipe(120, 300); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.querySelector('#notesSheet').classList.contains('open')), 'swipe right opens notes');
  await swipe(300, 100); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !document.querySelector('#notesSheet').classList.contains('open') && !SS.feed.activePlayer().paused), 'swipe notes back closes it and resumes');
  const i0 = await p.evaluate(() => SS.feed.activePlayer().sceneIdx);
  await p.mouse.click(370, 300); await p.waitForTimeout(300);
  ok(await p.evaluate(i => SS.feed.activePlayer().sceneIdx === i + 1, i0), 'right-edge tap -> next scene');
  await p.mouse.click(20, 300); await p.waitForTimeout(300);
  ok(await p.evaluate(i => SS.feed.activePlayer().sceneIdx === i, i0), 'left-edge tap -> previous scene');
  await tapActive('.cap-text'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.querySelector('#scriptSheet').classList.contains('open')), 'caption tap opens script popup');
  await p.click('#scriptSheet .close-sheet'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !SS.feed.activePlayer().paused), 'closing popup resumes playback');
  await p.click('#courseProgress'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.querySelectorAll('#mapBody .map-row').length === 80), 'course map lists all 80 reels');
  await p.click('#scriptSheet .close-sheet').catch(() => {});
  await p.mouse.click(370, 300); await p.mouse.click(370, 300); await p.waitForTimeout(500);   // go to scene 2
  const saved = await p.evaluate(() => SS.state.getLastReel() && JSON.parse(localStorage.lkg_v1).last.at);
  await p.reload(); await p.waitForTimeout(1500);
  await p.mouse.click(195, 400); await p.waitForTimeout(1200);
  ok(!!saved && await p.evaluate(i => SS.feed.activePlayer().sceneIdx === i, saved && saved.idx), 'reload resumes the exact scene (' + (saved && saved.idx) + ')');
  ok(await p.evaluate(() => !!SS.state.getLastReel()), 'last reel remembered across reload');
  await p.goto(url + '?reel=PY-05'); await p.waitForTimeout(1800);
  ok(await p.evaluate(() => SS.state.getLastReel() === 'PY-05'), 'deep link /?reel=PY-05 opens that reel');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); server.close();
  process.exit(fails ? 1 : 0);
})();
