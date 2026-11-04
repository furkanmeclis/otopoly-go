/** Service tag palette — same keys as web `catalog/lib/service-colors.ts`, rendered as hex pairs per theme. */
export const SERVICE_COLORS = ['sky', 'emerald', 'amber', 'rose', 'violet', 'indigo', 'teal', 'orange', 'pink', 'lime', 'cyan', 'slate'] as const;
export type ServiceColor = (typeof SERVICE_COLORS)[number];

// [solid (dot/stripe), light-mode text, dark-mode text]
const SWATCH: Record<ServiceColor, [string, string, string]> = {
  sky: ['#0EA5E9', '#0369A1', '#7DD3FC'],
  emerald: ['#10B981', '#047857', '#6EE7B7'],
  amber: ['#F59E0B', '#B45309', '#FCD34D'],
  rose: ['#F43F5E', '#BE123C', '#FDA4AF'],
  violet: ['#8B5CF6', '#6D28D9', '#C4B5FD'],
  indigo: ['#6366F1', '#4338CA', '#A5B4FC'],
  teal: ['#14B8A6', '#0F766E', '#5EEAD4'],
  orange: ['#F97316', '#C2410C', '#FDBA74'],
  pink: ['#EC4899', '#BE185D', '#F9A8D4'],
  lime: ['#84CC16', '#4D7C0F', '#BEF264'],
  cyan: ['#06B6D4', '#0E7490', '#67E8F9'],
  slate: ['#64748B', '#334155', '#CBD5E1'],
};

const isServiceColor = (v: string): v is ServiceColor => (SERVICE_COLORS as readonly string[]).includes(v);

/** Stored key, or a stable one derived from the name (same hash as web). */
export function resolveServiceColor(color: string | null | undefined, name: string): ServiceColor {
  if (color && isServiceColor(color)) return color;
  let h = 0;
  for (const ch of name.trim().toLocaleLowerCase('tr')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}

export function serviceSwatch(color: string | null | undefined, name: string, scheme: 'light' | 'dark') {
  const [solid, light, dark] = SWATCH[resolveServiceColor(color, name)];
  return { solid, text: scheme === 'dark' ? dark : light, bg: `${solid}26` };
}
