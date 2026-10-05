# landing-film

Remotion project that renders the scroll-scrubbed film for the beta landing page
(`/beta-landing`, `/en/beta-landing`). It is **not** part of the frontend build: it
produces static WebP frames that the page's `<canvas>` player draws as the visitor scrolls.

- One composition, `ScrollFilm` (300 frames @ 30 fps), props `{ theme: "light" | "dark", layout: "landscape" | "portrait" }`.
  Landscape is 1600×900, portrait 900×1600.
- The frames contain **no words** (only digits, the `34 OTP 34` plate, icons and skeleton bars);
  all copy is HTML laid over the canvas. Keep the left 42% (landscape) / top 38% (portrait) empty.
- Six chapters: arrival 0–49, work order 50–109, board 110–169, customer notified 170–219,
  signed 220–264, day closes 265–299. The page uses the same ranges for its text.

## Preview

```bash
npm install
npm run studio          # Remotion Studio; switch theme/layout in the props panel
npx remotion still ScrollFilm out/still.png --frame=145 --props='{"theme":"dark","layout":"portrait"}'
```

## Render frames

```bash
npm run render:frames                                   # all 4 variants, 300 frames each
npm run render:frames -- --variant dark-portrait        # one variant
npm run render:frames -- --every 10 --concurrency 4     # quick preview (30 frames per variant)
```

PNGs go to `landing-film/out/<variant>/` (git-ignored). WebPs (quality 72) are written to
`frontend/public/beta-landing/film/<variant>/0001.webp …` (stale files are removed first) together
with `frontend/public/beta-landing/film/manifest.json` (`version`, `frameCount`, per-variant size).
With `--every n`, frames are numbered sequentially and `frameCount` is reduced, so the page keeps
working with a coarser film. Commit the WebPs and manifest after a full render.

`npm run lint` type-checks the project.
