"use client";

import { PackageSearch } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { formatQuantity } from "@/features/finance/lib/format";
import { UrgencyBadge } from "@/features/stock-reorder/components/reorder-bits";
import {
  useReorderPreview,
  useStockReorderAccess,
} from "@/features/stock-reorder/hooks/use-stock-reorder";
import { useLocale } from "@/providers/locale-provider";

const MAX_ROWS = 6;

/** Dashboard card: the most urgent reorder suggestions (hidden without access, plan or urgent items). */
export function StockReorderWidget({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canRead } = useStockReorderAccess(slug);
  const preview = useReorderPreview(canRead);
  if (!canRead || preview.isError) return null;
  const items = (preview.data?.items ?? []).filter((i) => i.urgency !== "none");
  if (!preview.isLoading && items.length === 0) return null;

  return (
    <section
      className="bg-card flex flex-col rounded-2xl border"
      data-widget="stock-reorder"
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PackageSearch className="text-primary size-4" />
          {t("stock_reorder.widget.title")}
        </h2>
        <Link
          href={routes.tenant.purchases.reorder(slug)}
          className="text-primary text-xs font-medium hover:underline"
        >
          {t("stock_reorder.widget.open", { count: items.length })}
        </Link>
      </div>
      {preview.isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y">
          {items.slice(0, MAX_ROWS).map((item) => (
            <li key={item.product_uuid}>
              <Link
                href={routes.tenant.purchases.reorder(slug)}
                className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {t("stock_reorder.widget.line", {
                      stock: formatQuantity(item.stock, locale),
                      qty: formatQuantity(item.suggested_qty, locale),
                      unit: item.unit,
                    })}
                  </span>
                </span>
                <UrgencyBadge urgency={item.urgency} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
