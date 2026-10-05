export const FILM_FPS = 30;
export const FILM_FRAMES = 300;

export type Layout = "landscape" | "portrait";
export type ThemeName = "light" | "dark";

export const SIZES: Record<Layout, { width: number; height: number }> = {
  landscape: { width: 1600, height: 900 },
  portrait: { width: 900, height: 1600 },
};

/** Logical stage every visual is authored in. */
export const STAGE_W = 800;
export const STAGE_H = 760;

/**
 * The non-reserved area of the frame (HTML copy sits over the rest):
 * landscape → right 58% (x 700…1560), portrait → lower 62% (y 640…1540).
 * The logical stage is scaled to fit and centred inside it.
 */
export function stageBox(layout: Layout) {
  const area =
    layout === "landscape"
      ? { x: 700, y: 60, w: 860, h: 780 }
      : { x: 40, y: 640, w: 820, h: 900 };
  const s = Math.min(area.w / STAGE_W, area.h / STAGE_H);
  return {
    s,
    left: area.x + (area.w - STAGE_W * s) / 2,
    top: area.y + (area.h - STAGE_H * s) / 2,
  };
}
