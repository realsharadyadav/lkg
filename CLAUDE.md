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
