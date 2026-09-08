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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { CategoryDialog } from "@/features/catalog/components/categories/category-dialog";
import { useCategoriesColumns } from "@/features/catalog/components/categories/categories-columns";
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import {
  useCatalogCategories,
  useCatalogCategoriesMeta,
} from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import type { CatalogCategory } from "@/features/catalog/services/catalog.service";
import { ResourceIOToolbar } from "@/features/io";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function CategoriesPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canWrite } = useTenantCatalogAccess(slug);
  const { deleteCategory } = useCatalogMutations();

  const [activeTab, setActiveTab] = useState<"product" | "service" | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);

  const listState = useServerListState({
    initialSort: "sort_order",
    initialPageSize: 50,
  });

  const listParams = useMemo(() => {
    const activeRaw = listState.columnFilters.find(
      (filter) => filter.id === "is_active",
    )?.value;
    const activeFilter = Array.isArray(activeRaw)
      ? activeRaw[0]
      : typeof activeRaw === "string"
        ? activeRaw
        : undefined;

    return {
      kind: activeTab === "all" ? undefined : activeTab,
      is_active: activeFilter,
      q: listState.params.q,
    };
  }, [activeTab, listState.columnFilters, listState.params.q]);

  const listQuery = useCatalogCategories(listParams);
  const metaQuery = useCatalogCategoriesMeta();

  const handleDelete = useCallback(
    async (category: CatalogCategory) => {
      const confirmed = await confirmDelete({
        title: t("catalog.categories.delete"),
        description: t("catalog.categories.delete_confirm"),
      });
      if (!confirmed) return;
      await deleteCategory.mutateAsync(category.uuid);
    },
    [confirmDelete, deleteCategory, t],
  );

  const handleEdit = useCallback((category: CatalogCategory) => {
    setEditingCategory(category);
  }, []);

  const columns = useCategoriesColumns({
    onView: (category) =>
      router.push(routes.tenant.catalog.categories.detail(slug, category.uuid)),
    onEdit: handleEdit,
    onDelete: handleDelete,
    canWrite,
  });

  const items = listQuery.data?.items ?? [];

  return (
    <EntityPage
      title={t("catalog.categories.title")}
      description={t("catalog.categories.description")}
      breadcrumbs={[
        {
          label: t("layout.section_tenant"),
          href: routes.tenant.home(slug),
        },
        { label: t("catalog.categories.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("catalog.categories.new")}
          />
        ) : null
      }
    >
      <div className="mb-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "product" | "service" | "all")}
        >
          <TabsList>
            <TabsTrigger value="all">
              {t("catalog.categories.tab_all")} ({items.length})
            </TabsTrigger>
            <TabsTrigger value="product">
              {t("catalog.categories.tab_products")}
            </TabsTrigger>
            <TabsTrigger value="service">
              {t("catalog.categories.tab_services")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <EntityTable
        columns={columns}
        data={items}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.catalog.categories.detail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("catalog.categories.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("catalog.categories.empty_title")}
        emptyDescription={t("catalog.categories.empty_description")}
        pageCount={1}
        state={listState.tableState}
        features={{
          persistKey: `tenant-catalog-categories-${slug}`,
          rowSelection: false,
        }}
        toolbarExtra={
          <>
            <ResourceIOToolbar
              resource="tenant.catalog.categories"
              query={{
                q: listParams.q,
                is_active: listParams.is_active,
              }}
              capabilities={metaQuery.data?.capabilities}
              jobsHref={routes.tenant.exports.root(slug)}
              importJobsHref={routes.tenant.imports.root(slug)}
              scope="tenant"
              onImportComplete={() => void listQuery.refetch()}
            />
            <EntityToolbar
              onRefresh={() => void listQuery.refetch()}
              refreshDisabled={listQuery.isFetching}
            />
          </>
        }
      />

      <CategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultKind={activeTab === "service" ? "service" : "product"}
      />

      <CategoryDialog
        open={Boolean(editingCategory)}
        onOpenChange={(open) => !open && setEditingCategory(null)}
        category={editingCategory}
      />
    </EntityPage>
  );
}
