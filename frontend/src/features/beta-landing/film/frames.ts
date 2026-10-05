/**
 * Frame sequence for the beta landing scroll film.
 *
 * Frames are same-origin static files rendered by `landing-film/`:
 *   /beta-landing/film/manifest.json
 *   /beta-landing/film/<variant>/<0001..NNNN>.webp
 *
 * Everything here is module-level so a variant that was loaded once (e.g.
 * before a theme switch) is instant when the visitor switches back.
 */

export type FilmTheme = "light" | "dark";
export type FilmLayout = "landscape" | "portrait";
export type FilmVariant = `${FilmTheme}-${FilmLayout}`;

export type FilmManifest = {
  version: string;
  frameCount: number;
  variants: Partial<Record<FilmVariant, { width: number; height: number }>>;
};

const BASE = "/beta-landing/film";
const CONCURRENCY = 6;
const STRIDES = [16, 8, 4, 2, 1];

let manifestPromise: Promise<FilmManifest | null> | null = null;

/** Fetches the manifest once; resolves to `null` when the film is not built. */
export function loadManifest(): Promise<FilmManifest | null> {
  manifestPromise ??= fetch(`${BASE}/manifest.json`, { cache: "no-cache" })
    .then(async (res) => {
      if (!res.ok) return null;
      const m = (await res.json()) as Partial<FilmManifest>;
      if (
        typeof m.frameCount !== "number" ||
        m.frameCount < 1 ||
        !m.variants ||
        typeof m.variants !== "object"
      ) {
        return null;
      }
      return {
        version: String(m.version ?? ""),
        frameCount: m.frameCount,
        variants: m.variants,
      };
    })
    .catch(() => null);
  return manifestPromise;
}

/** URL of a 0-based frame index. */
export function frameUrl(
  manifest: FilmManifest,
  variant: FilmVariant,
  index: number,
): string {
  const n = String(index + 1).padStart(4, "0");
  const v = manifest.version
    ? `?v=${encodeURIComponent(manifest.version)}`
    : "";
  return `${BASE}/${variant}/${n}.webp${v}`;
}

type Listener = (index: number) => void;

type VariantStore = {
  frames: (HTMLImageElement | null)[];
  requested: Uint8Array;
  loadedCount: number;
  listeners: Set<Listener>;
  /** Bumped whenever a loader starts; older loaders stop scheduling work. */
  generation: number;
};

const stores = new Map<string, VariantStore>();

function storeFor(manifest: FilmManifest, variant: FilmVariant): VariantStore {
  const key = `${manifest.version}:${variant}`;
  let store = stores.get(key);
  if (!store) {
    store = {
      frames: new Array<HTMLImageElement | null>(manifest.frameCount).fill(
        null,
      ),
      requested: new Uint8Array(manifest.frameCount),
      loadedCount: 0,
      listeners: new Set(),
      generation: 0,
    };
    stores.set(key, store);
  }
  return store;
}

/** First + last frame, then passes of decreasing stride. */
function loadOrder(frameCount: number): number[] {
  const seen = new Uint8Array(frameCount);
  const order: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < frameCount && !seen[i]) {
      seen[i] = 1;
      order.push(i);
    }
  };
  push(0);
  push(frameCount - 1);
  for (const stride of STRIDES) {
    for (let i = 0; i < frameCount; i += stride) push(i);
  }
  return order;
}

async function fetchFrame(url: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

export type FilmSource = {
  /** The loaded frame closest to `index` (prefers earlier on ties), or null. */
  nearest: (index: number) => { image: HTMLImageElement; index: number } | null;
  /** Called with the frame index each time a frame finishes loading. */
  subscribe: (fn: Listener) => () => void;
  /** Stops scheduling new loads for this variant (in-flight ones still land in the cache). */
  stop: () => void;
};

/**
 * Starts (or resumes) progressive loading of a variant and returns a handle
 * to read frames from it. Only one loader per variant schedules work at a
 * time; calling `stop` (on variant change / unmount) halts it.
 */
export function openFilmSource(
  manifest: FilmManifest,
  variant: FilmVariant,
): FilmSource {
  const store = storeFor(manifest, variant);
  const generation = ++store.generation;
  const alive = () => store.generation === generation;
  const order = loadOrder(manifest.frameCount);
  let cursor = 0;

  const worker = async () => {
    while (alive() && cursor < order.length) {
      const index = order[cursor++];
      if (store.requested[index]) continue;
      store.requested[index] = 1;
      const img = await fetchFrame(frameUrl(manifest, variant, index));
      if (!img) {
        // Allow a later loader to retry this frame.
        store.requested[index] = 0;
        continue;
      }
      store.frames[index] = img;
      store.loadedCount++;
      store.listeners.forEach((fn) => fn(index));
    }
  };

  if (store.loadedCount < manifest.frameCount) {
    for (let i = 0; i < CONCURRENCY; i++) void worker();
  }

  return {
    nearest(index) {
      const { frames } = store;
      const last = frames.length - 1;
      const i = Math.min(last, Math.max(0, index));
      for (let d = 0; d <= last; d++) {
        const before = i - d;
        if (before >= 0 && frames[before]) {
          return { image: frames[before]!, index: before };
        }
        const after = i + d;
        if (after <= last && frames[after]) {
          return { image: frames[after]!, index: after };
        }
        if (before < 0 && after > last) break;
      }
      return null;
    },
    subscribe(fn) {
      store.listeners.add(fn);
      return () => {
        store.listeners.delete(fn);
      };
    },
    stop() {
      if (alive()) store.generation++;
    },
  };
}
