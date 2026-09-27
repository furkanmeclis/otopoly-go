"use client";

import { useMemo } from "react";
import { ArrowUpDown, Edit, Eye, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { EntityRowActions, type EntityRowAction } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import {
  catalogUnitLabel,
  CATALOG_UNIT_KEYS,
} from "@/features/catalog/lib/units";
import type { CatalogProduct } from "@/features/catalog/services/catalog.service";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type ProductRowHandlers = {
  onView?: (product: CatalogProduct) => void;
  onEdit?: (product: CatalogProduct) => void;
  onAdjustStock?: (product: CatalogProduct) => void;
  onDelete?: (product: CatalogProduct) => void;
  canWrite?: boolean;
};

export function ProductRowActionsMenu({
  product,
  handlers,
}: {
  product: CatalogProduct;
  handlers: ProductRowHandlers;
}) {
  const { t } = useLocale();

  const actions = useMemo<EntityRowAction[]>(() => {
    const list: EntityRowAction[] = [];

    if (handlers.onView) {
      list.push({
        id: "view",
        label: t("common.view"),
        icon: Eye,
        onSelect: () => handlers.onView?.(product),
      });
    }

    if (!handlers.canWrite) return list;

    if (handlers.onAdjustStock && product.track_stock) {
      list.push({
        id: "adjust-stock",
        label: t("catalog.products.adjust_stock"),
        icon: ArrowUpDown,
        onSelect: () => handlers.onAdjustStock?.(product),
      });
    }

    if (handlers.onEdit) {
      list.push({
        id: "edit",
        label: t("common.edit"),
        icon: Edit,
        onSelect: () => handlers.onEdit?.(product),
      });
    }

    if (handlers.onDelete) {
      list.push({
        id: "delete",
        label: t("common.delete"),
        icon: Trash2,
        variant: "destructive",
        onSelect: () => handlers.onDelete?.(product),
      });
    }

    return list;
  }, [product, handlers, t]);

  if (!actions.length) return null;
  return <EntityRowActions actions={actions} />;
}

const STOCK_STATUS_FILTERS = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "untracked",
] as const;

export type ProductColumnFilterOptions = {
  categories?: { value: string; label: string }[];
  lockCategory?: boolean;
};

export function useProductsColumns(
  handlers: ProductRowHandlers,
  filterOptions?: ProductColumnFilterOptions,
) {
  const { t, locale } = useLocale();

  return useMemo<ColumnDef<CatalogProduct>[]>(
    () => [
      createColumn<CatalogProduct>({
        accessorKey: "name",
        labelKey: "catalog.products.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">{p.name}</span>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                {p.sku && (
                  <span>
                    {t("catalog.products.sku")}: {p.sku}
                  </span>
                )}
                {p.sku && p.barcode && <span>•</span>}
                {p.barcode && (
                  <span>
                    {t("catalog.products.barcode")}: {p.barcode}
                  </span>
                )}
              </div>
            </div>
          );
        },
      }),
      createColumn<CatalogProduct>({
        id: "category_uuid",
        accessorFn: (row) => row.category_uuid ?? "",
        labelKey: "catalog.products.category",
        filterVariant: filterOptions?.lockCategory ? undefined : "select",
        filterOptions: filterOptions?.categories ?? [],
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.category_name || "—"}
          </span>
        ),
      }),
      createColumn<CatalogProduct>({
        accessorKey: "unit",
        labelKey: "catalog.products.unit",
        filterVariant: "select",
        filterOptions: CATALOG_UNIT_KEYS.map((value) => ({
          value,
          labelKey: `catalog.products.units.${value}`,
          label: value,
        })),
        cell: ({ row }) => {
          return (
            <span className="text-sm">
              {catalogUnitLabel(t, row.original.unit)}
            </span>
          );
        },
      }),
      createColumn<CatalogProduct>({
        accessorKey: "sale_price",
        labelKey: "catalog.products.sale_price",
        enableSorting: true,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium">
                {formatFinanceAmount(p.sale_price, p.currency, locale)}
              </span>
              {Number(p.cost_price) > 0 && (
                <span className="text-muted-foreground text-xs">
                  {t("catalog.products.cost_price")}:{" "}
                  {formatFinanceAmount(p.cost_price, p.currency, locale)}
                </span>
              )}
            </div>
          );
        },
      }),
      createColumn<CatalogProduct>({
        id: "stock_status",
        accessorFn: (row) => row.stock_quantity,
        labelKey: "catalog.products.stock_quantity",
        enableSorting: true,
        filterVariant: "select",
        filterOptions: STOCK_STATUS_FILTERS.map((value) => ({
          value,
          labelKey: `catalog.stock_status.${value}`,
          label: value,
        })),
        cell: ({ row }) => {
          const p = row.original;
          if (!p.track_stock) {
            return (
              <Badge
                variant="outline"
                className="text-muted-foreground text-xs"
              >
                {t("catalog.stock_status.untracked")}
              </Badge>
            );
          }

          const status = p.stock_status;
          let badgeVariant:
            | "default"
            | "secondary"
            | "danger"
            | "warning"
            | "success"
            | "outline" = "success";
          let badgeClass =
            "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";

          if (status === "low_stock") {
            badgeVariant = "warning";
            badgeClass =
              "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
          } else if (status === "out_of_stock") {
            badgeVariant = "danger";
            badgeClass =
              "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30";
          }

          return (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {formatQuantity(p.stock_quantity, locale)}{" "}
                {catalogUnitLabel(t, p.unit)}
              </span>
              <Badge
                variant={badgeVariant}
                className={cn("border text-xs", badgeClass)}
              >
                {t(`catalog.stock_status.${status}`)}
              </Badge>
            </div>
          );
        },
      }),
      createColumn<CatalogProduct>({
        accessorKey: "is_active",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: [
          { value: "true", labelKey: "common.active", label: "true" },
          { value: "false", labelKey: "common.passive", label: "false" },
        ],
        cell: ({ row }) => (
          <Badge
            variant={row.original.is_active ? "outline" : "secondary"}
            className={cn(
              row.original.is_active &&
                "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
            )}
          >
            {row.original.is_active ? t("common.active") : t("common.passive")}
          </Badge>
        ),
      }),
      createColumn<CatalogProduct>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ProductRowActionsMenu product={row.original} handlers={handlers} />
          </div>
        ),
      }),
    ],
    [
      filterOptions?.categories,
      filterOptions?.lockCategory,
      handlers,
      locale,
      t,
    ],
  );
}
