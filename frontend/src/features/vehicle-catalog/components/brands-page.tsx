"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ListTree, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BrandMark } from "@/components/common/brand-mark";
import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityPage,
  EntityRowActions,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { BrandEditDialog } from "@/features/vehicle-catalog/components/brand-edit-dialog";
import {
  CatalogTabs,
  useCatalogBreadcrumbs,
} from "@/features/vehicle-catalog/components/catalog-tabs";
import { DisplayBrandsTable } from "@/features/vehicle-catalog/components/display-brands-table";
import {
  CATALOG_CATEGORIES,
  firstFilterValue,
} from "@/features/vehicle-catalog/constants";
import {
  useCatalogBrands,
  useCatalogDisplayBrandOptions,
  useCatalogMeta,
} from "@/features/vehicle-catalog/hooks/use-catalog";
import type {
  CatalogBrand,
  ListBrandsParams,
} from "@/features/vehicle-catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

export type CatalogBrandsView = "tsb" | "display";

type CatalogBrandsPageProps = {
  initialView?: CatalogBrandsView;
  initialDisplayBrand?: string;
};

/**
 * Brands tab: raw TSB brands (one row per TSB brand code) or the display
 * brands users see, where several TSB brands are merged into one.
 */
export function CatalogBrandsPage({
  initialView = "tsb",
  initialDisplayBrand,
}: CatalogBrandsPageProps) {
  const { t } = useLocale();
  const router = useRouter();
  const breadcrumbs = useCatalogBreadcrumbs(t("vehicle_catalog.tabs.brands"));
  const [view, setView] = useState<CatalogBrandsView>(initialView);

  return (
    <EntityPage
      title={t("vehicle_catalog.title")}
      description={t("vehicle_catalog.description")}
      permission={permissions.vehicleBrands.read}
      forbiddenFallback={
        <ErrorState
          title={t("common.error_forbidden")}
          description={t("vehicle_catalog.forbidden")}
        />
      }
      breadcrumbs={breadcrumbs}
    >
      <CatalogTabs active="brands" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(next) => {
            if (!next) return;
            setView(next as CatalogBrandsView);
            router.replace(
              next === "display"
                ? `${routes.platform.vehicleCatalog.brands}?view=display`
                : routes.platform.vehicleCatalog.brands,
            );
          }}
          aria-label={t("vehicle_catalog.brands.view_label")}
        >
          <ToggleGroupItem value="tsb">
            {t("vehicle_catalog.brands.view_tsb")}
          </ToggleGroupItem>
          <ToggleGroupItem value="display">
            {t("vehicle_catalog.brands.view_display")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">
          {view === "display"
            ? t("vehicle_catalog.brands.view_display_hint")
            : t("vehicle_catalog.brands.view_tsb_hint")}
        </p>
      </div>
      {view === "display" ? (
        <DisplayBrandsTable />
      ) : (
        <TsbBrandsTable initialDisplayBrand={initialDisplayBrand} />
      )}
    </EntityPage>
  );
}

function TsbBrandsTable({
  initialDisplayBrand,
}: {
  initialDisplayBrand?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<CatalogBrand | null>(null);
  const listState = useServerListState({
    initialSort: "display_name",
    initialPageSize: 50,
    initialColumnFilters: initialDisplayBrand
      ? [{ id: "display_brand", value: [initialDisplayBrand] }]
      : undefined,
  });
  const displayBrands = useCatalogDisplayBrandOptions();

  const params = useMemo<ListBrandsParams>(
    () => ({
      ...listState.params,
      q:
        listState.params.q ||
        firstFilterValue(listState.columnFilters, "display_name"),
      category: firstFilterValue(listState.columnFilters, "category"),
      is_active: firstFilterValue(listState.columnFilters, "is_active"),
      display_brand: firstFilterValue(listState.columnFilters, "display_brand"),
    }),
    [listState.columnFilters, listState.params],
  );
  const listQuery = useCatalogBrands(params);
  useCatalogMeta("brands");
  const displayOptions = useMemo(
    () =>
      (displayBrands.data ?? []).map((d) => ({
        value: d.uuid,
        label: d.name,
      })),
    [displayBrands.data],
  );

  const columns = useMemo(
    () =>
      [
        createColumn<CatalogBrand>({
          accessorKey: "display_name",
          labelKey: "vehicle_catalog.columns.display_name",
          enableSorting: true,
          filterVariant: "text",
          gridPrimary: true,
          cell: ({ row }) => (
            <span className="font-medium">{row.original.display_name}</span>
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "tsb_name",
          labelKey: "vehicle_catalog.columns.tsb_name",
          enableSorting: true,
          gridSecondary: true,
          cell: ({ row }) => (
            <span className="text-muted-foreground font-mono text-xs">
              {row.original.tsb_name}
            </span>
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "tsb_code",
          labelKey: "vehicle_catalog.columns.tsb_code",
          enableSorting: true,
          cell: ({ row }) => (
            <code className="text-xs">{row.original.tsb_code}</code>
          ),
        }),
        createColumn<CatalogBrand>({
          id: "display_brand",
          accessorFn: (row) => row.display_brand.uuid,
          labelKey: "vehicle_catalog.columns.display_brand",
          filterVariant: "faceted",
          filterOptions: displayOptions,
          // Same text as the brand column: kept for the facet filter.
          defaultHidden: true,
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <BrandMark
                name={row.original.display_brand.name}
                logoUrl={row.original.display_brand.logo_url}
              />
              <span className="truncate">
                {row.original.display_brand.name}
              </span>
            </span>
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "category",
          labelKey: "vehicle_catalog.columns.category",
          enableSorting: true,
          filterVariant: "faceted",
          filterOptions: CATALOG_CATEGORIES.map((value) => ({
            value,
            label: value,
            labelKey: `vehicle_catalog.category.${value}`,
          })),
          cell: ({ row }) => (
            <Badge variant="secondary" className="font-normal">
              {t(`vehicle_catalog.category.${row.original.category}`)}
            </Badge>
          ),
        }),
        createColumn<CatalogBrand>({
          id: "is_active",
          accessorFn: (row) => String(row.is_active),
          labelKey: "vehicle_catalog.columns.is_active",
          filterVariant: "faceted",
          filterOptions: [
            {
              value: "true",
              label: "true",
              labelKey: "vehicle_catalog.active.true",
            },
            {
              value: "false",
              label: "false",
              labelKey: "vehicle_catalog.active.false",
            },
          ],
          cell: ({ row }) => (
            <StatusChip
              label={t(
                `vehicle_catalog.active.${String(row.original.is_active)}`,
              )}
              tone={row.original.is_active ? "success" : "default"}
            />
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "types_count",
          labelKey: "vehicle_catalog.columns.types_count",
          enableSorting: true,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.types_count}</span>
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "models_count",
          labelKey: "vehicle_catalog.columns.models_count",
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.models_count}</span>
          ),
        }),
        createColumn<CatalogBrand>({
          accessorKey: "unresolved_count",
          labelKey: "vehicle_catalog.columns.unresolved_count",
          cell: ({ row }) =>
            row.original.unresolved_count > 0 ? (
              <Badge variant="warning" className="tabular-nums">
                {row.original.unresolved_count}
              </Badge>
            ) : (
              <span className="text-muted-foreground">0</span>
            ),
        }),
        createColumn<CatalogBrand>({
          id: "actions",
          labelKey: "vehicle_catalog.columns.actions",
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => (
            <EntityRowActions
              actions={[
                {
                  id: "types",
                  label: t("vehicle_catalog.brands.view_types"),
                  icon: ListTree,
                  onSelect: () =>
                    router.push(
                      `${routes.platform.vehicleCatalog.types}?brand=${row.original.uuid}`,
                    ),
                },
                {
                  id: "edit",
                  label: t("vehicle_catalog.actions.edit"),
                  icon: Pencil,
                  permission: permissions.vehicleBrands.write,
                  onSelect: () => setEditing(row.original),
                },
              ]}
            />
          ),
        }),
      ] as ColumnDef<CatalogBrand, unknown>[],
    [displayOptions, router, t],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(
      (listQuery.data?.total ?? 0) / (listState.pagination.pageSize || 50),
    ),
  );

  return (
    <>
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(
            `${routes.platform.vehicleCatalog.models}?brand=${row.uuid}`,
          )
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("vehicle_catalog.brands.empty_title")}
        emptyDescription={t("vehicle_catalog.empty_description")}
        pageCount={pageCount}
        pageSizeOptions={[20, 50, 100]}
        state={listState.tableState}
        features={{
          persistKey: "platform-catalog-brands-v1",
          rowSelection: false,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
      <BrandEditDialog
        brand={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}
