/**
 * Pure helpers of the reorder screens (no React Native imports, so the smoke tests can run them).
 * The quantities are decimal strings like the API ("12", "1.5").
 */
import type { ReorderDraftItem, ReorderSuggestion, ReorderUrgency } from '../types';

export const NO_SUPPLIER = 'none';

const num = (v: string | null | undefined) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Renders a quantity without float noise or trailing zeros (3 decimals max). */
export function qtyString(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Stepper: one unit, or one pack when the product has a pack size (the value snaps to whole packs).
 * Never below zero.
 */
export function stepQty(current: string, dir: 1 | -1, packSize: string | null | undefined): string {
  const step = num(packSize) > 0 ? num(packSize) : 1;
  const value = num(current);
  const packs = value / step;
  const snapped = dir > 0 ? Math.floor(packs + 1e-9) + 1 : Math.ceil(packs - 1e-9) - 1;
  return qtyString(Math.max(0, snapped * step));
}

export type UrgencyTone = 'danger' | 'warning' | 'neutral' | 'success';

export function urgencyTone(u: ReorderUrgency): UrgencyTone {
  if (u === 'out_of_stock') return 'danger';
  if (u === 'below_min' || u === 'low_cover') return 'warning';
  return 'success';
}

export type SupplierSection = {
  key: string;
  supplierUuid: string | null;
  title: string;
  data: ReorderSuggestion[];
  /** Estimated total of the section's quantities (edited or suggested). */
  total: number;
};

/** Groups suggestions by preferred supplier (alphabetical, "no supplier" last); quantities from `qtyOf`. */
export function groupBySupplier(items: ReorderSuggestion[], qtyOf: (s: ReorderSuggestion) => string, noSupplierTitle: string, locale = 'tr'): SupplierSection[] {
  const map = new Map<string, SupplierSection>();
  for (const item of items) {
    const key = item.supplier?.uuid ?? NO_SUPPLIER;
    let section = map.get(key);
    if (!section) {
      section = { key, supplierUuid: item.supplier?.uuid ?? null, title: item.supplier?.name ?? noSupplierTitle, data: [], total: 0 };
      map.set(key, section);
    }
    section.data.push(item);
    section.total += num(qtyOf(item)) * num(item.unit_cost);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NO_SUPPLIER) return 1;
    if (b.key === NO_SUPPLIER) return -1;
    return a.title.localeCompare(b.title, locale);
  });
}

/** Body items for `POST /stock-reorder/drafts`: selected rows with a positive quantity. */
export function draftItems(items: ReorderSuggestion[], selected: ReadonlySet<string>, qtyOf: (s: ReorderSuggestion) => string): ReorderDraftItem[] {
  return items.filter((i) => selected.has(i.product_uuid) && num(qtyOf(i)) > 0).map((i) => ({ product_uuid: i.product_uuid, qty: qtyString(num(qtyOf(i))) }));
}

/** Selected rows that cannot become a draft because no supplier is known. */
export function missingSupplier(items: ReorderSuggestion[], selected: ReadonlySet<string>) {
  return items.filter((i) => selected.has(i.product_uuid) && !i.supplier);
}

/** Stock bar fill 0–1: the bar spans twice the minimum (or the stock when larger). */
export function stockFill(item: Pick<ReorderSuggestion, 'stock' | 'min_stock'>): number {
  const stock = num(item.stock);
  const scale = Math.max(num(item.min_stock) * 2, stock, 1);
  return Math.max(0, Math.min(1, stock / scale));
}
