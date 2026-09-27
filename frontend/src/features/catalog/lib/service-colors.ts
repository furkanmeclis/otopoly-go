/**
 * Service tag palette. Keys are stored on the service (services.color);
 * an empty key falls back to a stable colour derived from the name so
 * existing services get distinct tags without any setup.
 */
export const SERVICE_COLORS = [
  "sky",
  "emerald",
  "amber",
  "rose",
  "violet",
  "indigo",
  "teal",
  "orange",
  "pink",
  "lime",
  "cyan",
  "slate",
] as const;

export type ServiceColor = (typeof SERVICE_COLORS)[number];

type Swatch = { badge: string; stripe: string; dot: string };

// Full class names so Tailwind keeps them.
const SWATCHES: Record<ServiceColor, Swatch> = {
  sky: {
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    stripe: "bg-sky-500",
    dot: "bg-sky-500",
  },
  emerald: {
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    stripe: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  amber: {
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    stripe: "bg-amber-500",
    dot: "bg-amber-500",
  },
  rose: {
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    stripe: "bg-rose-500",
    dot: "bg-rose-500",
  },
  violet: {
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    stripe: "bg-violet-500",
    dot: "bg-violet-500",
  },
  indigo: {
    badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    stripe: "bg-indigo-500",
    dot: "bg-indigo-500",
  },
  teal: {
    badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    stripe: "bg-teal-500",
    dot: "bg-teal-500",
  },
  orange: {
    badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    stripe: "bg-orange-500",
    dot: "bg-orange-500",
  },
  pink: {
    badge: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
    stripe: "bg-pink-500",
    dot: "bg-pink-500",
  },
  lime: {
    badge: "bg-lime-500/20 text-lime-800 dark:text-lime-300",
    stripe: "bg-lime-500",
    dot: "bg-lime-500",
  },
  cyan: {
    badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    stripe: "bg-cyan-500",
    dot: "bg-cyan-500",
  },
  slate: {
    badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    stripe: "bg-slate-500",
    dot: "bg-slate-500",
  },
};

function isServiceColor(v: string): v is ServiceColor {
  return (SERVICE_COLORS as readonly string[]).includes(v);
}

/** The stored key, or a stable one derived from the name. */
export function resolveServiceColor(
  color: string | null | undefined,
  name: string,
): ServiceColor {
  if (color && isServiceColor(color)) return color;
  let h = 0;
  for (const ch of name.trim().toLocaleLowerCase("tr")) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}

export function serviceSwatch(
  color: string | null | undefined,
  name: string,
): Swatch {
  return SWATCHES[resolveServiceColor(color, name)];
}

export function swatchOf(color: ServiceColor): Swatch {
  return SWATCHES[color];
}
