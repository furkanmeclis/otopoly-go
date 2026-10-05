import { Easing, interpolate } from "remotion";

/** House easing: calm, decelerating, no overshoot. */
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 0.75, 0.2);

/** Clamped, eased interpolation between two frames. */
export function ramp(
  f: number,
  f0: number,
  f1: number,
  from = 0,
  to = 1,
  easing: (n: number) => number = EASE,
) {
  if (f1 <= f0) return f >= f1 ? to : from;
  return interpolate(f, [f0, f1], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** Rises 0→1 over [a,b] and falls back 1→0 over [c,d]. */
export function bump(f: number, a: number, b: number, c: number, d: number) {
  return ramp(f, a, b) * (1 - ramp(f, c, d, 0, 1, EASE_IN_OUT));
}

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export type Pt = { x: number; y: number };
export const lerpPt = (a: Pt, b: Pt, p: number): Pt => ({
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
});

/** Hex (#rrggbb) to rgba() with alpha. */
export function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
