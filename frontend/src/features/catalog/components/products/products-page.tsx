"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  EntityCreateButton,
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { StatsCard } from "@/components/common/stats-card";
import { createSelectColumnDef } from "@/components/tables";
import { routes } from "@/config/routes";
import { ProductDialog } from "@/features/catalog/components/products/product-dialog";
import { StockAdjustmentDialog } from "@/features/catalog/components/products/stock-adjustment-dialog";
import { useProductsColumns } from "@/features/catalog/components/products/products-columns";
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import {
  useCatalogCategories,
  useCatalogProducts,
  useCatalogProductsMeta,
  useCatalogSummary,
} from "@/features/catalog/hooks/use-catalog-queries";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import type { CatalogProduct } from "@/features/catalog/services/catalog.service";
import {
  BulkActionMenu,
  SelectionBanner,
  resolveBulkActionsWithIcons,
  useBulkSelection,
} from "@/features/bulk-engine";
import { ResourceIOToolbar } from "@/features/io";
import { useDialogs } from "@/providers/dialog-provider";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useLocale } from "@/providers/locale-provider";

export function ProductsPage({
  slug,
  categoryUuid,
}: {
  slug: string;
  categoryUuid?: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canWrite } = useTenantCatalogAccess(slug);
  const { deleteProduct } = useCatalogMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(
    null,
  );
  const [adjustingProduct, setAdjustingProduct] =
    useState<CatalogProduct | null>(null);

  const listState = useServerListState({
    initialSort: "name",
    initialPageSize: 20,
  });

  const categoriesQuery = useCatalogCategories({ kind: "product" });
  const categoryOptions = useMemo(
    () =>
      (categoriesQuery.data?.items ?? []).map((category) => ({
        value: category.uuid,
        label: category.name,
      })),
    [categoriesQuery.data?.items],
  );

  const { columnFilters, params: listQueryParams } = listState;
  const listParams = useMemo(() => {
    const nameQ = columnTextValue(columnFilters, "name");
    const stockStatus = columnSelectValue(columnFilters, "stock_status");
    const categoryFilter = categoryUuid
      ? categoryUuid
      : columnSelectValue(columnFilters, "category_uuid");

    return {
      ...listQueryParams,
      q: listQueryParams.q?.trim() || nameQ,
      is_active: columnSelectValue(columnFilters, "is_active"),
      unit: columnSelectValue(columnFilters, "unit"),
      category_uuid: categoryFilter,
      stock_status:
        stockStatus && stockStatus !== "untracked" ? stockStatus : undefined,
      track_stock: stockStatus
        ? stockStatus === "untracked"
          ? "false"
          : "true"
        : undefined,
    };
  }, [categoryUuid, columnFilters, listQueryParams]);

  const summaryQuery = useCatalogSummary();
  const listQuery = useCatalogProducts(listParams);
  const metaQuery = useCatalogProductsMeta();

  const openDetail = useCallback(
    (product: CatalogProduct) => {
      router.push(routes.tenant.catalog.products.detail(slug, product.uuid));
    },
    [router, slug],
  );

  const handleDelete = useCallback(
    async (product: CatalogProduct) => {
      const confirmed = await confirmDelete({
        title: t("catalog.products.delete"),
        description: t("catalog.products.delete_confirm"),
      });
      if (!confirmed) return;
      await deleteProduct.mutateAsync(product.uuid);
    },
    [confirmDelete, deleteProduct, t],
  );

  const baseColumns = useProductsColumns(
    {
      onView: openDetail,
      onEdit: setEditingProduct,
      onAdjustStock: setAdjustingProduct,
      onDelete: handleDelete,
      canWrite,
    },
    { categories: categoryOptions, lockCategory: Boolean(categoryUuid) },
  );
  const columns = useMemo(
    () =>
      canWrite
        ? [createSelectColumnDef<CatalogProduct>(), ...baseColumns]
        : baseColumns,
    [baseColumns, canWrite],
  );

  const bulkQuery = useMemo(
    () => ({
      q: listParams.q,
      is_active: listParams.is_active,
      unit: listParams.unit,
      stock_status: listParams.stock_status,
      track_stock: listParams.track_stock,
      sort: listParams.sort,
      ...(listParams.category_uuid
        ? { category_uuid: listParams.category_uuid }
        : {}),
    }),
    [listParams],
  );

  const bulkSelection = useBulkSelection({
    listQueryKey: listParams,
    bulkQuery,
    total: listQuery.data?.total ?? 0,
  });

  const bulkActions = useMemo(
    () =>
      resolveBulkActionsWithIcons(
        "tenant.catalog.products",
        metaQuery.data?.bulk_actions ?? [],
      ),
    [metaQuery.data?.bulk_actions],
  );

  const pageCount = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const size = listState.pagination.pageSize || 20;
    return Math.max(1, Math.ceil(total / size));
  }, [listQuery.data?.total, listState.pagination.pageSize]);

  const summary = summaryQuery.data;
  const embedded = Boolean(categoryUuid);

  const table = (
    <>
      {canWrite ? (
        <SelectionBanner
          selectedCount={bulkSelection.selectedCount}
          total={listQuery.data?.total ?? 0}
          showSelectAll={bulkSelection.showSelectAllBanner}
          allMatchingSelected={bulkSelection.scope.mode === "all"}
          onSelectAllMatching={bulkSelection.selectAllMatching}
          onClearSelection={bulkSelection.clearSelection}
        />
      ) : null}

      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={openDetail}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("catalog.products.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("catalog.products.empty_title")}
        emptyDescription={t("catalog.products.empty_description")}
        pageCount={pageCount}
        state={{
          ...listState.tableState,
          ...(canWrite
            ? {
                rowSelection: bulkSelection.rowSelection,
                onRowSelectionChange: bulkSelection.onRowSelectionChange,
              }
            : {}),
        }}
        features={{
          persistKey: categoryUuid
            ? `tenant-catalog-products-${slug}-${categoryUuid}`
            : `tenant-catalog-products-${slug}`,
          rowSelection: canWrite,
        }}
        toolbarExtra={
          <>
            {canWrite ? (
              <BulkActionMenu
                resource="tenant.catalog.products"
                actions={bulkActions}
                scope={bulkSelection.scope}
                selectedCount={bulkSelection.selectedCount}
                onComplete={() => void listQuery.refetch()}
              />
            ) : null}
            {!embedded ? (
              <ResourceIOToolbar
                resource="tenant.catalog.products"
                query={{
                  q: listParams.q,
                  is_active: listParams.is_active,
                  unit: listParams.unit,
                  stock_status: listParams.stock_status,
                  track_stock: listParams.track_stock,
                  sort: listParams.sort,
                  ...(listParams.category_uuid
                    ? { category_uuid: listParams.category_uuid }
                    : {}),
                }}
                capabilities={metaQuery.data?.capabilities}
                jobsHref={routes.tenant.exports.root(slug)}
                importJobsHref={routes.tenant.imports.root(slug)}
                scope="tenant"
                onImportComplete={() => void listQuery.refetch()}
              />
            ) : null}
            <EntityToolbar
              onRefresh={() => void listQuery.refetch()}
              refreshDisabled={listQuery.isFetching}
            />
          </>
        }
      />

      <ProductDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ProductDialog
        open={Boolean(editingProduct)}
        onOpenChange={(open) => !open && setEditingProduct(null)}
        product={editingProduct}
      />

      <StockAdjustmentDialog
        open={Boolean(adjustingProduct)}
        onOpenChange={(open) => !open && setAdjustingProduct(null)}
        product={adjustingProduct}
      />
    </>
  );

  if (embedded) return table;

  return (
    <EntityPage
      title={t("catalog.products.title")}
      description={t("catalog.products.description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        { label: t("catalog.products.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("catalog.products.new")}
          />
        ) : null
      }
    >
      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard
            title={t("catalog.summary.total_products")}
            value={summary.total_products}
          />
          <StatsCard
            title={t("catalog.summary.low_stock_products")}
            value={summary.low_stock_products}
            hint={
              summary.low_stock_products > 0
                ? t("catalog.summary.low_stock_hint")
                : undefined
            }
          />
          <StatsCard
            title={t("catalog.summary.out_of_stock_products")}
            value={summary.out_of_stock_products}
          />
          <StatsCard
            title={t("catalog.summary.total_stock_sale_value")}
            value={formatFinanceAmount(
              summary.total_stock_sale_value,
              "TRY",
              locale,
            )}
          />
        </div>
      ) : null}

      {table}
    </EntityPage>
  );
}
