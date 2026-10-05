#!/usr/bin/env node
// Renders the ScrollFilm composition to PNG frames (landing-film/out/<variant>/), converts
// them to WebP (frontend/public/beta-landing/film/<variant>/0001.webp …) and writes manifest.json.
//
//   node scripts/render-frames.mjs [--variant light-landscape] [--every 10] [--concurrency 4] [--scale 1.5]
//
// --scale renders above the 1600×900 / 900×1600 composition size (default 1.5) so frames stay
// sharp on high-DPI screens; the manifest records the rendered pixel size.
//
// --every n renders every n-th frame and numbers the WebPs sequentially, so the manifest's
// frameCount shrinks accordingly and the page still works (just coarser) — handy for previews.
import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILM_DIR = path.resolve(ROOT, "..", "frontend", "public", "beta-landing", "film");
const VARIANTS = ["light-landscape", "dark-landscape", "light-portrait", "dark-portrait"];
const SIZES = { landscape: { width: 1600, height: 900 }, portrait: { width: 900, height: 1600 } };

function parseArgs(argv) {
  const out = { variant: null, every: 1, concurrency: null, scale: 1.5 };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    const take = () => (inline === undefined ? i++ : null);
    if (key === "--variant") { out.variant = val; take(); }
    else if (key === "--every") { out.every = Number(val); take(); }
    else if (key === "--concurrency") { out.concurrency = Number(val); take(); }
    else if (key === "--scale") { out.scale = Number(val); take(); }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (out.variant && !VARIANTS.includes(out.variant)) {
    throw new Error(`--variant must be one of ${VARIANTS.join(", ")}`);
  }
  if (!Number.isInteger(out.every) || out.every < 1) throw new Error("--every must be a positive integer");
  if (!(out.scale > 0)) throw new Error("--scale must be a positive number");
  return out;
}

const args = parseArgs(process.argv.slice(2));
const variants = args.variant ? [args.variant] : VARIANTS;

console.log("Bundling…");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts") });

const totals = {};
let frameCount = 0;
const hash = createHash("sha1");

for (const variant of variants) {
  const [theme, layout] = variant.split("-");
  const inputProps = { theme, layout };
  const composition = await selectComposition({ serveUrl, id: "ScrollFilm", inputProps });

  const pngDir = path.join(ROOT, "out", variant);
  fs.rmSync(pngDir, { recursive: true, force: true });
  fs.mkdirSync(pngDir, { recursive: true });

  console.log(`\n▶ ${variant} (${composition.width * args.scale}×${composition.height * args.scale}, every ${args.every})`);
  let last = 0;
  await renderFrames({
    serveUrl,
    composition,
    inputProps,
    outputDir: pngDir,
    imageFormat: "png",
    scale: args.scale,
    everyNthFrame: args.every,
    concurrency: args.concurrency,
    onStart: ({ frameCount: n }) => console.log(`  rendering ${n} frames`),
    onFrameUpdate: (done) => {
      if (done - last >= 25) {
        last = done;
        process.stdout.write(`  ${done} frames\r`);
      }
    },
  });

  const pngs = fs
    .readdirSync(pngDir)
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => Number(a.match(/(\d+)\.png$/)[1]) - Number(b.match(/(\d+)\.png$/)[1]));

  const webpDir = path.join(FILM_DIR, variant);
  fs.mkdirSync(webpDir, { recursive: true });
  for (const f of fs.readdirSync(webpDir)) {
    if (f.endsWith(".webp")) fs.unlinkSync(path.join(webpDir, f));
  }

  let bytes = 0;
  await Promise.all(
    pngs.map(async (png, i) => {
      const dest = path.join(webpDir, `${String(i + 1).padStart(4, "0")}.webp`);
      const info = await sharp(path.join(pngDir, png)).webp({ quality: 72, effort: 5 }).toFile(dest);
      bytes += info.size;
    }),
  );
  for (let i = 0; i < pngs.length; i++) {
    hash.update(fs.readFileSync(path.join(webpDir, `${String(i + 1).padStart(4, "0")}.webp`)));
  }
  totals[variant] = { frames: pngs.length, bytes };
  frameCount = pngs.length;
}

const manifest = {
  version: hash.digest("hex").slice(0, 10),
  frameCount,
  variants: Object.fromEntries(
    VARIANTS.map((v) => {
      const size = SIZES[v.split("-")[1]];
      return [v, { width: Math.round(size.width * args.scale), height: Math.round(size.height * args.scale) }];
    }),
  ),
};
fs.mkdirSync(FILM_DIR, { recursive: true });
fs.writeFileSync(path.join(FILM_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("\nDone.");
for (const [v, { frames, bytes }] of Object.entries(totals)) {
  console.log(`  ${v.padEnd(16)} ${String(frames).padStart(4)} frames  ${(bytes / 1024 / 1024).toFixed(2)} MB  (avg ${(bytes / frames / 1024).toFixed(1)} KB)`);
}
console.log(`  manifest → ${path.relative(process.cwd(), path.join(FILM_DIR, "manifest.json"))} (version ${manifest.version}, frameCount ${frameCount})`);
