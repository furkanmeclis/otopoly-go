"use client";

// TODO(catalog): Child categories, default margin, and category-level price rules.

import { useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { CategoryDialog } from "@/features/catalog/components/categories/category-dialog";
import { ProductsPage } from "@/features/catalog/components/products/products-page";
import { ServicesPage } from "@/features/catalog/components/services/services-page";
import { useCatalogCategory } from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function CategoryDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { canWrite } = useTenantCatalogAccess(slug);
  const query = useCatalogCategory(uuid);
  const category = query.data;
  const [editing, setEditing] = useState(false);

  const title = category?.name ?? t("catalog.detail.category_title");
  const isProduct = category?.kind === "product";

  return (
    <EntityPage
      title={title}
      description={t("catalog.detail.category_description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        {
          label: t("catalog.categories.title"),
          href: routes.tenant.catalog.categories.root(slug),
        },
        { label: title },
      ]}
      actions={
        canWrite && category ? (
          <Button type="button" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("catalog.detail.category_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {category ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip
              label={
                isProduct
                  ? t("catalog.categories.kind_product")
                  : t("catalog.categories.kind_service")
              }
              tone="default"
            />
            <StatusChip
              label={
                category.is_active ? t("common.active") : t("common.passive")
              }
              tone={category.is_active ? "success" : "default"}
            />
          </div>

          <EntitySectionCard title={t("catalog.detail.category_info")}>
            <EntityDetail
              sections={[
                {
                  id: "category",
                  fields: [
                    {
                      key: "name",
                      label: t("catalog.categories.name"),
                      value: category.name,
                    },
                    {
                      key: "kind",
                      label: t("catalog.categories.kind"),
                      value: isProduct
                        ? t("catalog.categories.kind_product")
                        : t("catalog.categories.kind_service"),
                    },
                    {
                      key: "parent",
                      label: t("catalog.categories.parent"),
                      value: category.parent_name || "—",
                    },
                    {
                      key: "sort",
                      label: t("catalog.categories.sort_order"),
                      value: category.sort_order,
                    },
                    {
                      key: "created",
                      label: t("catalog.detail.created_at"),
                      value: datetime(
                        category.created_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                    {
                      key: "updated",
                      label: t("catalog.detail.updated_at"),
                      value: datetime(
                        category.updated_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <EntitySectionCard
            title={
              isProduct
                ? t("catalog.detail.products_in_category")
                : t("catalog.detail.services_in_category")
            }
          >
            {isProduct ? (
              <ProductsPage slug={slug} categoryUuid={uuid} />
            ) : (
              <ServicesPage slug={slug} categoryUuid={uuid} />
            )}
          </EntitySectionCard>
        </div>
      ) : null}

      <CategoryDialog
        open={editing}
        onOpenChange={setEditing}
        category={category}
      />
    </EntityPage>
  );
}
