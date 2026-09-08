"use client";

import { useMemo } from "react";
import { Edit, Eye, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { EntityRowActions, type EntityRowAction } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import type { CatalogCategory } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type CategoryRowHandlers = {
  onView?: (category: CatalogCategory) => void;
  onEdit?: (category: CatalogCategory) => void;
  onDelete?: (category: CatalogCategory) => void;
  canWrite?: boolean;
};

export function CategoryRowActionsMenu({
  category,
  handlers,
}: {
  category: CatalogCategory;
  handlers: CategoryRowHandlers;
}) {
  const { t } = useLocale();

  const actions = useMemo<EntityRowAction[]>(() => {
    const list: EntityRowAction[] = [];

    if (handlers.onView) {
      list.push({
        id: "view",
        label: t("common.view"),
        icon: Eye,
        onSelect: () => handlers.onView?.(category),
      });
    }

    if (!handlers.canWrite) return list;

    if (handlers.onEdit) {
      list.push({
        id: "edit",
        label: t("common.edit"),
        icon: Edit,
        onSelect: () => handlers.onEdit?.(category),
      });
    }

    if (handlers.onDelete) {
      list.push({
        id: "delete",
        label: t("common.delete"),
        icon: Trash2,
        variant: "destructive",
        onSelect: () => handlers.onDelete?.(category),
      });
    }

    return list;
  }, [category, handlers, t]);

  if (!actions.length) return null;
  return <EntityRowActions actions={actions} />;
}

export function useCategoriesColumns(handlers: CategoryRowHandlers) {
  const { t } = useLocale();

  return useMemo<ColumnDef<CatalogCategory>[]>(
    () => [
      createColumn<CatalogCategory>({
        accessorKey: "name",
        labelKey: "catalog.categories.name",
        enableSorting: true,
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.name}
          </span>
        ),
      }),
      createColumn<CatalogCategory>({
        accessorKey: "kind",
        labelKey: "catalog.categories.kind",
        cell: ({ row }) => {
          const isProduct = row.original.kind === "product";
          return (
            <Badge variant="outline" className="text-xs">
              {isProduct
                ? t("catalog.categories.kind_product")
                : t("catalog.categories.kind_service")}
            </Badge>
          );
        },
      }),
      createColumn<CatalogCategory>({
        accessorKey: "parent_name",
        labelKey: "catalog.categories.parent",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.parent_name || "—"}
          </span>
        ),
      }),
      createColumn<CatalogCategory>({
        accessorKey: "sort_order",
        labelKey: "catalog.categories.sort_order",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sort_order}
          </span>
        ),
      }),
      createColumn<CatalogCategory>({
        accessorKey: "is_active",
        labelKey: "common.status",
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
      createColumn<CatalogCategory>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <CategoryRowActionsMenu category={row.original} handlers={handlers} />
          </div>
        ),
      }),
    ],
    [handlers, t],
  );
}
