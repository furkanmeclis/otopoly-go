import type { ComboboxOption } from "@/components/ui/async-combobox";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import { formatQuantity } from "@/features/finance/lib/format";
import { catalogService } from "@/features/catalog/services/catalog.service";
import type { AppLocale } from "@/config/i18n";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Active products for pickers, with the current stock as description. */
export async function loadProductOptions(
  query: string,
  t: T,
  locale: AppLocale,
): Promise<ComboboxOption[]> {
  const result = await catalogService.listProducts({
    limit: 20,
    offset: 0,
    q: query.trim() || undefined,
    is_active: "true",
    sort: "name",
  });
  return result.items.map((p) => ({
    value: p.uuid,
    label: p.sku ? `${p.name} · ${p.sku}` : p.name,
    description: p.track_stock
      ? `${t("catalog.products.stock_quantity")}: ${formatQuantity(p.stock_quantity, locale)} ${catalogUnitLabel(t, p.unit)}`
      : undefined,
  }));
}
