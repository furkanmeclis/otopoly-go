"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import { useReorderSummary } from "@/features/stock-reorder/hooks/use-stock-reorder";
import { permissions } from "@/config/permissions";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

/** Sidebar badge: out-of-stock + below-minimum products (hidden when 0 or the plan excludes the module). */
function useStockReorderNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { hasPermission } = usePermission();
  const enabled =
    hasPermission(permissions.purchases.read) &&
    hasPermission(permissions.catalog.read);
  const { data } = useReorderSummary(enabled);
  if (!data) return {};
  return {
    badges:
      data.urgent > 0
        ? [
            {
              kind: "count",
              value: data.urgent,
              variant: data.out_of_stock > 0 ? "danger" : "warning",
            },
          ]
        : [],
    info: {
      title: t("stock_reorder.nav.info_title"),
      rows: [
        {
          label: t("stock_reorder.urgency.out_of_stock"),
          value: data.out_of_stock,
          tone: data.out_of_stock > 0 ? "danger" : undefined,
        },
        {
          label: t("stock_reorder.urgency.below_min"),
          value: data.below_min,
          tone: data.below_min > 0 ? "warning" : undefined,
        },
        { label: t("stock_reorder.urgency.low_cover"), value: data.low_cover },
        { label: t("stock_reorder.summary.drafts"), value: data.drafts },
      ],
    },
  };
}

export const StockReorderNavAdornment = createNavAdornment(
  useStockReorderNavAdornment,
);
