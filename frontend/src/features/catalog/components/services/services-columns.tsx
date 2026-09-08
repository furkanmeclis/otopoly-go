"use client";

import { useMemo } from "react";
import { Clock, Edit, Eye, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { EntityRowActions, type EntityRowAction } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import type { CatalogService } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type ServiceRowHandlers = {
  onView?: (service: CatalogService) => void;
  onEdit?: (service: CatalogService) => void;
  onDelete?: (service: CatalogService) => void;
  canWrite?: boolean;
};

export function ServiceRowActionsMenu({
  service,
  handlers,
}: {
  service: CatalogService;
  handlers: ServiceRowHandlers;
}) {
  const { t } = useLocale();

  const actions = useMemo<EntityRowAction[]>(() => {
    const list: EntityRowAction[] = [];

    if (handlers.onView) {
      list.push({
        id: "view",
        label: t("common.view"),
        icon: Eye,
        onSelect: () => handlers.onView?.(service),
      });
    }

    if (!handlers.canWrite) return list;

    if (handlers.onEdit) {
      list.push({
        id: "edit",
        label: t("common.edit"),
        icon: Edit,
        onSelect: () => handlers.onEdit?.(service),
      });
    }

    if (handlers.onDelete) {
      list.push({
        id: "delete",
        label: t("common.delete"),
        icon: Trash2,
        variant: "destructive",
        onSelect: () => handlers.onDelete?.(service),
      });
    }

    return list;
  }, [service, handlers, t]);

  if (!actions.length) return null;
  return <EntityRowActions actions={actions} />;
}

export type ServiceColumnFilterOptions = {
  categories?: { value: string; label: string }[];
  lockCategory?: boolean;
};

export function useServicesColumns(
  handlers: ServiceRowHandlers,
  filterOptions?: ServiceColumnFilterOptions,
) {
  const { t } = useLocale();

  return useMemo<ColumnDef<CatalogService>[]>(
    () => [
      createColumn<CatalogService>({
        accessorKey: "name",
        labelKey: "catalog.services.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">{s.name}</span>
              {s.code && (
                <span className="text-xs text-muted-foreground">
                  {t("catalog.services.code")}: {s.code}
                </span>
              )}
            </div>
          );
        },
      }),
      createColumn<CatalogService>({
        id: "category_uuid",
        accessorFn: (row) => row.category_uuid ?? "",
        labelKey: "catalog.services.category",
        filterVariant: filterOptions?.lockCategory ? undefined : "select",
        filterOptions: filterOptions?.categories ?? [],
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.category_name || "—"}
          </span>
        ),
      }),
      createColumn<CatalogService>({
        accessorKey: "duration_minutes",
        labelKey: "catalog.services.duration",
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 text-sm text-foreground">
            <Clock className="size-3.5 text-muted-foreground" />
            <span>
              {t("catalog.services.duration_value", {
                minutes: row.original.duration_minutes,
              })}
            </span>
          </div>
        ),
      }),
      createColumn<CatalogService>({
        accessorKey: "price",
        labelKey: "catalog.services.price",
        enableSorting: true,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-semibold text-foreground">
                {s.price} {s.currency}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("catalog.services.vat_suffix", { rate: s.vat_rate })}
              </span>
            </div>
          );
        },
      }),
      createColumn<CatalogService>({
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
      createColumn<CatalogService>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ServiceRowActionsMenu service={row.original} handlers={handlers} />
          </div>
        ),
      }),
    ],
    [filterOptions?.categories, filterOptions?.lockCategory, handlers, t],
  );
}
