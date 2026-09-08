type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export const CATALOG_UNIT_KEYS = [
  "piece",
  "liter",
  "kg",
  "meter",
  "box",
  "set",
] as const;

const UNIT_KEYS = CATALOG_UNIT_KEYS;

export function catalogUnitLabel(t: Translate, unit: string) {
  const normalized = unit === "pieces" ? "piece" : unit;
  if (!UNIT_KEYS.includes(normalized as (typeof UNIT_KEYS)[number])) {
    return unit;
  }
  const key = `catalog.products.units.${normalized}`;
  const label = t(key);
  return label === key ? unit : label;
}
