# LKG — notes for contributors (and Claude)

## Release rule: bump the build on EVERY change pushed to main
Run `scripts/bump-build.sh` before every commit that goes to `main` — any change at all
(JS, CSS, HTML, sw.js). It bumps, in one go:
- the service-worker cache name in `sw.js` (`lkg-shell-vN`) — this is what makes phones drop old files
- the `?v=N` on every CSS/JS tag in `index.html` — keeps HTML and JS from mixing versions
- the `build N` label at the bottom of Settings — so the user can confirm the phone runs the new code

Never edit these numbers by hand. Skipping the bump can leave phones on stale or mixed code
(that is what broke audio on iOS before build 17).

## Verify before pushing
- `node tests/smoke.js` (Playwright + Chromium) must pass.
- After deploy, check Settings → bottom shows the new `build N` on the phone.

## Audio on iOS
All clips play through ONE shared `<audio>` element (`js/audio.js`) unlocked from a tap
(pointerup/touchend/click). Don't create `new Audio()` per clip, and don't start sound from
`pointerdown` — iOS Safari blocks both.

## SEO pages
`learn/*.html`, `sitemap.xml` and `robots.txt` are generated from the reel JSON.
Re-run `python3 scripts/build-seo.py` whenever reel content or the manifest changes, and commit the output.
Lesson pages link into the app with `/?reel=<ID>` (handled in `js/feed.js`).

## Story scenes (narration-cued visuals) — "make reel X like PY-01"
Reel visuals should SHOW what the narration says, not just print text. PY-01 scenes 0, 2, 3 are the
reference (`data/reels/PY-01.json`). Engine: `story` in `js/scenes.js`; styles: `.st-*` in `css/app.css`;
the player feeds narration progress (0..1) to the scene via `ctx.onProgress` (`js/player.js`).

How to convert a reel:
1. Read the reel's scenes + narration. Pick the scenes that explain a concept (a process, a comparison,
   "where does X live") — plain `bigtext`/`list` scenes can stay. Don't convert everything.
2. Replace the scene's `type` with `story`. KEEP `chapter`, `kicker`, `title`, `sub` and the `narration`
   text byte-for-byte, and keep scene order/indices — audio clips are keyed `ID/s<index>`.
3. Add `h` (stage height px, ~290-300), `actors` and `steps`:
   - actor: `{id, k, x, y, w?, h?, e?, t?, s?, tone?, on?, c?}` — x,y = centre in % of the stage.
     `k`: panel (container) | chip | pkg (emoji circle) | tag (small label) | term (terminal, typed text).
     `tone`: good | bad | accent | dashed. `c: "sm"` = smaller chip. `on: true` = visible from the start.
   - step: `{at: "phrase from the narration", do: [[op, id, ...], ...]}`.
     ops: show hide hot unhot dim undim tone(id,name|'') text(id,str) move(id,x,y) pulse.
   - Steps are STATES (replayed from the top when the user scrubs back), never one-shot effects.
   - `at` must be an exact phrase of the narration (case-insensitive); a missing one logs a console warning.
     Cue on the first words of what is being said; the engine fires slightly early on purpose.
4. The real stage is only ~0.81 x the phone width: 292px on a 360px phone, 316 on 390, 348 on 430. Design
   for 292px. Sizes: chip ~7px/char + 50px (`"c":"sm"`: 6.2px/char + 42px), tag ~5.8px/char + 42px, emoji +20px.
   Shorten texts, drop emoji, use two rows rather than five items in a row. Keep x within ~8-90 (a button rail
   covers the far right). Reuse the existing pieces; only add a new actor kind if nothing fits.
5. Verify WITHOUT screenshots (cheap) — both must report 0 errors:
   - `python3 scripts/set-story.py <ID> <scene idx> story.json` writes one scene (touches only that scene's text,
     keeps narration/chapter/kicker/title/sub); story.json = {"h","actors","steps"}.
   - `node scripts/check-story.js <ID>` — static: cue phrases exist, ops/ids valid, actors on stage, no overlap,
     narration/scene order unchanged vs git HEAD.
   - `NODE_PATH=$(npm root -g) CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome VW=360 VH=740 node scripts/measure-story.js <ID>`
     — opens a real browser and MEASURES actors (OFF / CLIP / OVERLAP). This is the ground truth; a subagent's
     "0 errors" report is not enough, re-run it yourself. Then `node tests/smoke.js` (its `#courseProgress`
     click step is flaky on baseline too — rerun before blaming your change).
   A screenshot (jump to the scene, `SS.feed.activePlayer()._cue(f)`) is only for judging how it LOOKS.
6. Keep the JSON's existing formatting (arrays of objects inline, one per line) so diffs stay small.
7. `scripts/bump-build.sh`, commit, and only push to `main` when the user says so.
