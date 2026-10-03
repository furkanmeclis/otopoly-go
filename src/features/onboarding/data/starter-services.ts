/**
 * Suggested catalog services for a new car-wash / detailing business, ported from the web onboarding
 * wizard (otopoly-go frontend/src/features/onboarding/data/starter-services.ts). Prices are editable
 * starting points in TRY; the owner can change them later in the catalog.
 */
export const STARTER_SERVICES = [
  { key: 'exterior', name: 'Dış yıkama', price: '250', selected: true },
  { key: 'full', name: 'İç-dış yıkama', price: '450', selected: true },
  { key: 'interior', name: 'Detaylı iç temizlik', price: '1400', selected: true },
  { key: 'engine', name: 'Motor yıkama', price: '600', selected: false },
  { key: 'seats', name: 'Koltuk yıkama', price: '900', selected: false },
  { key: 'polish', name: 'Pasta cila', price: '2100', selected: true },
  { key: 'ceramic', name: 'Seramik kaplama', price: '4250', selected: false },
  { key: 'ppf', name: 'PPF kaplama', price: '38000', selected: false },
] as const;

export type StarterService = {
  key: string;
  name: string;
  price: string;
  selected: boolean;
};

/** "1.400" / "1400,50" → "1400.50" (API decimal). Same rules as the web wizard. */
export function normalizePrice(raw: string): string {
  const cleaned = raw.replace(/[^\d,.]/g, '');
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  if (lastSep === -1) return cleaned;
  const decimals = cleaned.slice(lastSep + 1);
  // A 3-digit tail after the only separator is a thousands separator.
  if (decimals.length === 3) return cleaned.replace(/[.,]/g, '');
  return `${cleaned.slice(0, lastSep).replace(/[.,]/g, '')}.${decimals}`;
}
