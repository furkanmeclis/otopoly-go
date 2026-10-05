"use client";

/* eslint-disable @next/next/no-img-element -- frames are pre-sized static
   WebP files drawn 1:1 with the canvas; next/image would re-encode them. */

import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useMotionValue,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import type {
  BetaLandingChapter,
  BetaLandingContent,
} from "@/features/beta-landing/content";
import {
  frameUrl,
  loadManifest,
  openFilmSource,
  type FilmLayout,
  type FilmManifest,
  type FilmTheme,
  type FilmVariant,
} from "@/features/beta-landing/film/frames";
import { fill, type LandingContent } from "@/features/landing/content";
import { cn } from "@/lib/utils";

/**
 * Storyboard chapter ranges in film frames (inclusive), out of 300. They are
 * used as fractions so the page still lines up if the film is re-rendered
 * with a different frame count.
 */
const STORYBOARD_FRAMES = 300;
const CHAPTER_FRAMES: readonly (readonly [number, number])[] = [
  [0, 49],
  [50, 109],
  [110, 169],
  [170, 219],
  [220, 264],
  [265, 299],
];
const CHAPTER_RANGES = CHAPTER_FRAMES.map(
  ([a, b]) => [a / STORYBOARD_FRAMES, (b + 1) / STORYBOARD_FRAMES] as const,
);
/**
 * Fade length at each chapter boundary (progress units). The outgoing copy
 * fades out just before the boundary and the next fades in just after it,
 * so two blocks of text never overlap.
 */
const FADE = 0.025;

const PORTRAIT_QUERY = "(max-aspect-ratio: 1/1)";

/**
 * Where the film's visuals live inside a frame, as fractions of the frame
 * (mirrors `stageBox` in landing-film/src/lib/stage.ts). The rest of the frame
 * is plain page background.
 */
const FILM_STAGE: Record<
  FilmLayout,
  { x: number; y: number; w: number; h: number }
> = {
  landscape: { x: 719.5 / 1600, y: 60 / 900, w: 821 / 1600, h: 780 / 900 },
  portrait: { x: 40 / 900, y: 700.5 / 1600, w: 820 / 900, h: 779 / 1600 },
};

/**
 * Places a frame so its stage fits the screen area next to (landscape) or
 * under (portrait) the copy. A plain cover fit would crop the stage on
 * screens narrower than the frame (4:3 tablets, small laptops), and on
 * phones it would run under the hero actions. The frame background equals
 * the page background, so the uncovered canvas is invisible.
 */
function placeFrame(
  layout: FilmLayout,
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
) {
  const area =
    layout === "landscape"
      ? {
          left: width * 0.43,
          right: width - Math.max(56, width * 0.04),
          top: Math.min(88, height * 0.1),
          bottom: height - Math.min(40, height * 0.05),
        }
      : {
          left: width * 0.04,
          right: width * 0.96,
          top: height * 0.4,
          bottom: height - Math.min(150, height * 0.18),
        };
  const stage = FILM_STAGE[layout];
  const stageW = stage.w * frameWidth;
  const stageH = stage.h * frameHeight;
  const scale = Math.min(
    (area.right - area.left) / stageW,
    (area.bottom - area.top) / stageH,
  );
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  return {
    x: cx - (stage.x * frameWidth + stageW / 2) * scale,
    y: cy - (stage.y * frameHeight + stageH / 2) * scale,
    w: frameWidth * scale,
    h: frameHeight * scale,
  };
}

/**
 * Fastest the film may play, in progress units per second (0.2 → 60 film
 * frames a second, at least 5 s for the whole film). A flick of the wheel or
 * a long touch swipe would otherwise skip dozens of frames at once, which
 * reads as stutter; the playhead glides there instead.
 */
const MAX_SPEED = 0.2;
/** How quickly the playhead closes the remaining gap (1/s). */
const CATCH_UP = 7;

/**
 * Follows the scroll position with an eased approach capped at `MAX_SPEED`.
 * The copy and the canvas both read this value, so text and picture stay in
 * step. Starts at the current scroll position (no replay after a reload).
 */
function usePlayhead(target: MotionValue<number>): MotionValue<number> {
  const playhead = useMotionValue(target.get());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const goal = target.get();
      const current = playhead.get();
      const gap = goal - current;
      if (Math.abs(gap) < 0.0002) {
        playhead.set(goal);
        raf = 0;
        last = 0;
        return;
      }
      const speed = Math.min(MAX_SPEED, Math.abs(gap) * CATCH_UP);
      const step = Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
      playhead.set(current + step);
      raf = requestAnimationFrame(tick);
    };
    // Scroll restoration on reload lands before the first frames are painted;
    // follow those readings directly instead of replaying the film from 0.
    let primed = false;
    const prime = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        playhead.jump(target.get());
        primed = true;
      });
    });
    const start = () => {
      if (!primed) {
        playhead.jump(target.get());
        return;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    playhead.jump(target.get());
    const off = target.on("change", start);
    return () => {
      off();
      cancelAnimationFrame(prime);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, playhead]);
  return playhead;
}

function layoutOf(variant: FilmVariant): FilmLayout {
  return variant.endsWith("portrait") ? "portrait" : "landscape";
}

function chapterAt(p: number): number {
  for (let i = CHAPTER_RANGES.length - 1; i >= 0; i--) {
    if (p >= CHAPTER_RANGES[i][0]) return i;
  }
  return 0;
}

/** Middle frame of a chapter, scaled to the manifest's frame count. */
function keyFrame(manifest: FilmManifest, chapter: number): number {
  const [a, b] = CHAPTER_FRAMES[chapter];
  const mid = (a + b) / 2 / (STORYBOARD_FRAMES - 1);
  return Math.round(mid * (manifest.frameCount - 1));
}

const noopSubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function subscribePortrait(onChange: () => void) {
  const mq = window.matchMedia(PORTRAIT_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useFilmLayout(): FilmLayout {
  const portrait = useSyncExternalStore(
    subscribePortrait,
    () => window.matchMedia(PORTRAIT_QUERY).matches,
    () => false,
  );
  return portrait ? "portrait" : "landscape";
}

function useFilmTheme(isClient: boolean): FilmTheme {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme) return resolvedTheme === "dark" ? "dark" : "light";
  // Before next-themes mounts, its blocking script has already set the class.
  if (isClient && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return "light";
}

/** `undefined` while loading, `null` when the film has not been rendered. */
function useManifest() {
  const [manifest, setManifest] = useState<FilmManifest | null | undefined>();
  useEffect(() => {
    let active = true;
    void loadManifest().then((m) => {
      if (active) setManifest(m);
    });
    return () => {
      active = false;
    };
  }, []);
  return manifest;
}

type Hero = LandingContent["hero"];

export function ScrollFilm({
  content,
  hero,
}: {
  content: BetaLandingContent["film"];
  hero: Hero;
}) {
  const reduce = useReducedMotion();
  const isClient = useIsClient();
  const theme = useFilmTheme(isClient);
  const layout = useFilmLayout();
  const manifest = useManifest();
  const variant: FilmVariant = `${theme}-${layout}`;
  const film = manifest && manifest.variants[variant] ? manifest : null;

  if (reduce) {
    return (
      <StaticFilm content={content} hero={hero} manifest={film} theme={theme} />
    );
  }
  return (
    <PinnedFilm
      content={content}
      hero={hero}
      manifest={film}
      variant={variant}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Pinned, scroll-scrubbed film                                               */
/* -------------------------------------------------------------------------- */

function PinnedFilm({
  content,
  hero,
  manifest,
  variant,
}: {
  content: BetaLandingContent["film"];
  hero: Hero;
  manifest: FilmManifest | null;
  variant: FilmVariant;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const progress = usePlayhead(scrollYProgress);
  // Driven by the JS playhead rather than the raw scroll value: motion would
  // otherwise hand a plain scroll → opacity mapping to a native ScrollTimeline,
  // which ignores the section offsets.
  const hintOpacity = useTransform(progress, [0, 0.03], [1, 0]);

  const [chapter, setChapter] = useState(0);
  useMotionValueEvent(progress, "change", (p) => setChapter(chapterAt(p)));

  // Which variant the canvas currently shows; the poster covers it until then.
  const [drawnVariant, setDrawnVariant] = useState<FilmVariant | null>(null);
  // Sticky box size in CSS px, to place the poster exactly like the canvas.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const posterSize = manifest?.variants[variant];
  const posterBox =
    box && posterSize
      ? placeFrame(
          layoutOf(variant),
          box.w,
          box.h,
          posterSize.width,
          posterSize.height,
        )
      : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!manifest || !canvas || !ctx) return;

    const source = openFilmSource(manifest, variant);
    const last = manifest.frameCount - 1;
    let raf = 0;
    let drawnKey = "";
    let announced = false;

    const draw = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, progress.get()));
      const hit = source.nearest(Math.round(p * last));
      if (!hit || canvas.width === 0 || canvas.height === 0) return;
      const key = `${hit.index}:${canvas.width}x${canvas.height}`;
      if (key === drawnKey) return;
      drawnKey = key;

      const { naturalWidth: iw, naturalHeight: ih } = hit.image;
      const box = placeFrame(
        layoutOf(variant),
        canvas.width,
        canvas.height,
        iw,
        ih,
      );
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(hit.image, box.x, box.y, box.w, box.h);
      if (!announced) {
        announced = true;
        setDrawnVariant(variant);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      setBox({ w: canvas.clientWidth, h: canvas.clientHeight });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingQuality = "high";
      drawnKey = "";
      // Resizing clears the bitmap; repaint in the same task to avoid a blank frame.
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    schedule();

    const offProgress = progress.on("change", schedule);
    // A newly loaded frame may be closer to the requested one.
    const offLoad = source.subscribe(schedule);

    return () => {
      ro.disconnect();
      offProgress();
      offLoad();
      source.stop();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [manifest, variant, progress]);

  const goTo = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const travel = section.offsetHeight - window.innerHeight;
    const [a, b] = CHAPTER_RANGES[index];
    const target = index === 0 ? 0 : a + Math.min(FADE * 1.5, (b - a) / 3);
    window.scrollTo({ top: top + target * travel, behavior: "smooth" });
  };

  const count = CHAPTER_RANGES.length;
  const showPoster = manifest !== null && drawnVariant !== variant;

  return (
    <section
      id="film"
      ref={sectionRef}
      aria-label={content.label}
      className="relative scroll-mt-0"
      style={{ height: `${(count + 1) * 100}svh` }}
    >
      <div className="bg-background sticky top-0 h-svh w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          aria-hidden
          className={cn(
            "absolute inset-0 size-full",
            manifest ? "opacity-100" : "opacity-0",
          )}
        />
        {showPoster && manifest && posterBox ? (
          <img
            key={variant}
            src={frameUrl(manifest, variant, 0)}
            alt=""
            aria-hidden
            fetchPriority="high"
            decoding="async"
            className="absolute max-w-none"
            style={{
              left: posterBox.x,
              top: posterBox.y,
              width: posterBox.w,
              height: posterBox.h,
            }}
          />
        ) : null}

        {content.chapters.slice(0, count).map((c, i) => (
          <PinnedChapter
            key={i}
            index={i}
            chapter={c}
            hero={hero}
            progress={progress}
          />
        ))}

        <ChapterRail
          active={chapter}
          count={count}
          label={content.chapterNav}
          itemLabel={content.goToChapter}
          onSelect={goTo}
        />

        <motion.div
          aria-hidden
          style={{ opacity: hintOpacity }}
          className="text-muted-foreground pointer-events-none absolute inset-x-0 bottom-7 flex flex-col items-center gap-1 text-xs font-medium portrait:bottom-12"
        >
          {content.scrollHint}
          <motion.span
            animate={{ y: [0, 5, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown className="size-4" />
          </motion.span>
        </motion.div>
      </div>
    </section>
  );
}

/** One chapter's copy, crossfading in/out with the scroll position. */
function PinnedChapter({
  index,
  chapter,
  hero,
  progress,
}: {
  index: number;
  chapter: BetaLandingChapter;
  hero: Hero;
  progress: MotionValue<number>;
}) {
  const [a, b] = CHAPTER_RANGES[index];
  const isFirst = index === 0;
  const isLast = index === CHAPTER_RANGES.length - 1;
  const input = [a, a + FADE, b - FADE, b];
  const opacity = useTransform(progress, input, [
    isFirst ? 1 : 0,
    1,
    1,
    isLast ? 1 : 0,
  ]);
  const y = useTransform(progress, input, [
    isFirst ? 0 : 24,
    0,
    0,
    isLast ? 0 : -24,
  ]);
  const visibility = useTransform(opacity, (o) =>
    o < 0.02 ? "hidden" : "visible",
  );
  const pointerEvents = useTransform(opacity, (o): "auto" | "none" =>
    o > 0.5 ? "auto" : "none",
  );

  return (
    <motion.div
      style={{ opacity, visibility }}
      className="pointer-events-none absolute inset-0"
    >
      <motion.div style={{ y }} className="size-full">
        <ChapterCopy
          index={index}
          chapter={chapter}
          hero={hero}
          ctaPointerEvents={pointerEvents}
        />
      </motion.div>
    </motion.div>
  );
}

function ChapterRail({
  active,
  count,
  label,
  itemLabel,
  onSelect,
}: {
  active: number;
  count: number;
  label: string;
  itemLabel: string;
  onSelect: (index: number) => void;
}) {
  return (
    <nav
      aria-label={label}
      className="absolute top-1/2 right-3 z-10 -translate-y-1/2 sm:right-5 portrait:top-auto portrait:right-auto portrait:bottom-3 portrait:left-1/2 portrait:-translate-x-1/2 portrait:translate-y-0"
    >
      <ol className="flex flex-col items-center portrait:flex-row">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-label={fill(itemLabel, { n: i + 1 })}
              aria-current={i === active ? "step" : undefined}
              className="focus-visible:ring-ring group grid place-items-center rounded-full p-2 outline-none focus-visible:ring-2"
            >
              <span
                className={cn(
                  "block rounded-full transition-all duration-300",
                  i === active
                    ? "bg-primary h-5 w-1.5 portrait:h-1.5 portrait:w-5"
                    : "bg-foreground/20 group-hover:bg-foreground/40 size-1.5",
                )}
              />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared chapter copy                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Text over the film. Landscape: left column, vertically centred, aligned
 * with the navbar container (the film keeps its left 42% empty). Portrait:
 * centred under the navbar (the film keeps its top 38% empty).
 */
function ChapterCopy({
  index,
  chapter,
  hero,
  ctaPointerEvents,
}: {
  index: number;
  chapter: BetaLandingChapter;
  hero: Hero;
  ctaPointerEvents?: MotionValue<"auto" | "none">;
}) {
  const isFirst = index === 0;
  const Heading = isFirst ? "h1" : "h2";

  return (
    <>
      <div className="mx-auto flex h-full max-w-6xl items-center px-4 sm:px-6 portrait:items-start portrait:justify-center portrait:pt-24 portrait:text-center sm:portrait:pt-32">
        <div className="w-full max-w-md portrait:max-w-lg landscape:max-w-[min(28rem,40vw)]">
          <p className="text-primary flex items-center gap-3 text-sm font-medium portrait:justify-center">
            <span className="tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span aria-hidden className="bg-primary/40 h-px w-6" />
            <span>{chapter.eyebrow}</span>
          </p>
          <Heading
            className={cn(
              "font-display text-foreground mt-4 font-semibold tracking-tight text-balance portrait:mt-3",
              isFirst
                ? "text-4xl leading-[1.04] lg:text-[3.5rem] portrait:text-[1.85rem] sm:portrait:text-5xl"
                : "text-3xl leading-[1.08] lg:text-[2.75rem] portrait:text-[1.6rem] sm:portrait:text-4xl",
            )}
          >
            {chapter.title}
          </Heading>
          <p className="text-muted-foreground mt-5 text-base leading-relaxed text-pretty lg:text-lg portrait:mt-3 portrait:text-[0.9rem] portrait:leading-snug sm:portrait:text-base">
            {chapter.body}
          </p>

          {isFirst ? (
            <motion.div
              style={{ pointerEvents: ctaPointerEvents }}
              className="portrait:hidden"
            >
              <HeroActions hero={hero} />
              <ul className="text-muted-foreground mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {hero.trust.map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="text-primary size-4" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </div>
      </div>

      {/* Portrait: the top zone is too short for actions, so they sit at the
          bottom of the screen, under the film's stage. */}
      {isFirst ? (
        <motion.div
          style={{ pointerEvents: ctaPointerEvents }}
          className="absolute inset-x-0 bottom-24 flex justify-center px-4 landscape:hidden"
        >
          <HeroActions hero={hero} compact />
        </motion.div>
      ) : null}
    </>
  );
}

function HeroActions({ hero, compact }: { hero: Hero; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "w-full max-w-sm" : "mt-8 flex-col sm:flex-row",
      )}
    >
      <Button
        asChild
        size="lg"
        className={cn(
          "group rounded-full shadow-[0_10px_40px_-12px_#EA6E43]",
          compact ? "h-11 flex-1 px-4" : "h-12 px-6 text-base",
        )}
      >
        <Link href={routes.public.register}>
          {hero.primaryCta}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Button>
      <Button
        asChild
        size="lg"
        variant="outline"
        className={cn(
          "bg-background/70 rounded-full backdrop-blur",
          compact ? "h-11 px-4" : "h-12 px-6 text-base",
        )}
      >
        <Link href="/login">{hero.secondaryCta}</Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reduced motion: stacked chapters with static key frames                    */
/* -------------------------------------------------------------------------- */

function StaticFilm({
  content,
  hero,
  manifest,
  theme,
}: {
  content: BetaLandingContent["film"];
  hero: Hero;
  manifest: FilmManifest | null;
  theme: FilmTheme;
}) {
  return (
    <section id="film" aria-label={content.label}>
      {content.chapters.slice(0, CHAPTER_RANGES.length).map((c, i) => (
        <div
          key={i}
          className="bg-background relative h-svh min-h-[34rem] overflow-hidden"
        >
          {manifest ? (
            <picture>
              {manifest.variants[`${theme}-portrait`] ? (
                <source
                  media={PORTRAIT_QUERY}
                  srcSet={frameUrl(
                    manifest,
                    `${theme}-portrait`,
                    keyFrame(manifest, i),
                  )}
                />
              ) : null}
              <img
                src={frameUrl(
                  manifest,
                  `${theme}-landscape`,
                  keyFrame(manifest, i),
                )}
                alt=""
                aria-hidden
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                className="absolute inset-0 size-full object-cover"
              />
            </picture>
          ) : null}
          <div className="absolute inset-0">
            <ChapterCopy index={i} chapter={c} hero={hero} />
          </div>
        </div>
      ))}
    </section>
  );
}
