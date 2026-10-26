import type { CalendarColor } from '../types';

/** Calendar colour keys (API `CalendarColor`) as [solid, light-mode text, dark-mode text]; same hues as the web chips. */
const SWATCH: Record<CalendarColor, [string, string, string]> = {
  blue: ['#3B82F6', '#1D4ED8', '#93C5FD'],
  emerald: ['#10B981', '#047857', '#6EE7B7'],
  amber: ['#F59E0B', '#B45309', '#FCD34D'],
  rose: ['#F43F5E', '#BE123C', '#FDA4AF'],
  violet: ['#8B5CF6', '#6D28D9', '#C4B5FD'],
  sky: ['#0EA5E9', '#0369A1', '#7DD3FC'],
  orange: ['#F97316', '#C2410C', '#FDBA74'],
  teal: ['#14B8A6', '#0F766E', '#5EEAD4'],
  pink: ['#EC4899', '#BE185D', '#F9A8D4'],
  slate: ['#64748B', '#334155', '#CBD5E1'],
};

export function calendarSwatch(color: CalendarColor, scheme: 'light' | 'dark') {
  const [solid, light, dark] = SWATCH[color] ?? SWATCH.blue;
  return { solid, text: scheme === 'dark' ? dark : light, bg: `${solid}${scheme === 'dark' ? '33' : '1F'}`, border: `${solid}66` };
}
