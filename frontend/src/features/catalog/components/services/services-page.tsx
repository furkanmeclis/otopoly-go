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
import { ServiceDialog } from "@/features/catalog/components/services/service-dialog";
import { useServicesColumns } from "@/features/catalog/components/services/services-columns";
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import {
  useCatalogCategories,
  useCatalogServices,
  useCatalogServicesMeta,
  useCatalogSummary,
} from "@/features/catalog/hooks/use-catalog-queries";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import type { CatalogService } from "@/features/catalog/services/catalog.service";
import {
  BulkActionMenu,
  SelectionBanner,
  resolveBulkActionsWithIcons,
  useBulkSelection,
} from "@/features/bulk-engine";
import { ResourceIOToolbar } from "@/features/io";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function ServicesPage({
  slug,
  categoryUuid,
}: {
  slug: string;
  categoryUuid?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canWrite } = useTenantCatalogAccess(slug);
  const { deleteService } = useCatalogMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingService, setEditingService] = useState<CatalogService | null>(
    null,
  );

  const listState = useServerListState({
    initialSort: "name",
    initialPageSize: 20,
  });

  const categoriesQuery = useCatalogCategories({ kind: "service" });
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
    const categoryFilter = categoryUuid
      ? categoryUuid
      : columnSelectValue(columnFilters, "category_uuid");

    return {
      ...listQueryParams,
      q: listQueryParams.q?.trim() || nameQ,
      is_active: columnSelectValue(columnFilters, "is_active"),
      category_uuid: categoryFilter,
    };
  }, [categoryUuid, columnFilters, listQueryParams]);

  const summaryQuery = useCatalogSummary();
  const listQuery = useCatalogServices(listParams);
  const metaQuery = useCatalogServicesMeta();

  const openDetail = useCallback(
    (service: CatalogService) => {
      router.push(routes.tenant.catalog.services.detail(slug, service.uuid));
    },
    [router, slug],
  );

  const handleDelete = useCallback(
    async (service: CatalogService) => {
      const confirmed = await confirmDelete({
        title: t("catalog.services.delete"),
        description: t("catalog.services.delete_confirm"),
      });
      if (!confirmed) return;
      await deleteService.mutateAsync(service.uuid);
    },
    [confirmDelete, deleteService, t],
  );

  const baseColumns = useServicesColumns(
    {
      onView: openDetail,
      onEdit: setEditingService,
      onDelete: handleDelete,
      canWrite,
    },
    { categories: categoryOptions, lockCategory: Boolean(categoryUuid) },
  );
  const columns = useMemo(
    () =>
      canWrite
        ? [createSelectColumnDef<CatalogService>(), ...baseColumns]
        : baseColumns,
    [baseColumns, canWrite],
  );

  const bulkQuery = useMemo(
    () => ({
      q: listParams.q,
      is_active: listParams.is_active,
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
        "tenant.catalog.services",
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
        errorDescription={t("catalog.services.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("catalog.services.empty_title")}
        emptyDescription={t("catalog.services.empty_description")}
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
            ? `tenant-catalog-services-${slug}-${categoryUuid}`
            : `tenant-catalog-services-${slug}`,
          rowSelection: canWrite,
        }}
        toolbarExtra={
          <>
            {canWrite ? (
              <BulkActionMenu
                resource="tenant.catalog.services"
                actions={bulkActions}
                scope={bulkSelection.scope}
                selectedCount={bulkSelection.selectedCount}
                onComplete={() => void listQuery.refetch()}
              />
            ) : null}
            {!embedded ? (
              <ResourceIOToolbar
                resource="tenant.catalog.services"
                query={{
                  q: listParams.q,
                  is_active: listParams.is_active,
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

      <ServiceDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ServiceDialog
        open={Boolean(editingService)}
        onOpenChange={(open) => !open && setEditingService(null)}
        service={editingService}
      />
    </>
  );

  if (embedded) return table;

  return (
    <EntityPage
      title={t("catalog.services.title")}
      description={t("catalog.services.description")}
      breadcrumbs={[
        {
          label: t("layout.section_tenant"),
          href: routes.tenant.home(slug),
        },
        { label: t("catalog.services.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("catalog.services.new")}
          />
        ) : null
      }
    >
      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatsCard
            title={t("catalog.summary.total_services")}
            value={summary.total_services}
          />
          <StatsCard
            title={t("catalog.summary.active_services")}
            value={summary.active_services}
          />
          <StatsCard
            title={t("catalog.summary.total_categories")}
            value={summary.total_categories}
          />
        </div>
      ) : null}

      {table}
    </EntityPage>
  );
}
