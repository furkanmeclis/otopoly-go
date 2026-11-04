/** Product units — same keys as web `catalog/lib/units.ts`. */
export const CATALOG_UNIT_KEYS = ['piece', 'liter', 'kg', 'meter', 'box', 'set'] as const;
export type CatalogUnit = (typeof CATALOG_UNIT_KEYS)[number];

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function catalogUnitLabel(t: Translate, unit: string) {
  const normalized = unit === 'pieces' ? 'piece' : unit;
  if (!(CATALOG_UNIT_KEYS as readonly string[]).includes(normalized)) return unit;
  const key = `catalog.products.units.${normalized}`;
  const label = t(key);
  return label === key ? unit : label;
}

/** "1.234,5" style input → API decimal string ("1234.5"); keeps a leading minus when allowed. */
export function normalizeDecimal(raw: string, allowNegative = false) {
  const trimmed = raw.trim().replace(',', '.');
  const negative = allowNegative && trimmed.startsWith('-');
  const body = trimmed.replace(/[^0-9.]/g, '');
  const [int, ...dec] = body.split('.');
  const value = dec.length ? `${int}.${dec.join('')}` : int;
  return negative ? `-${value}` : value;
}
