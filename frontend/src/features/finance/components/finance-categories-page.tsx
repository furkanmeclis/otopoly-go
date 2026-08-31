"use client";

// TODO(finance): Category edit/deactivate row actions; split income/expense tabs with kind filter.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  EntityCreateButton,
  EntityPage,
  EntityTable,
  EntityToolbar,
} from "@/components/entity";
import { routes } from "@/config/routes";
import { FinanceCategoryDialog } from "@/features/finance/components/finance-category-dialog";
import { useFinanceCategoriesColumns } from "@/features/finance/components/finance-categories-columns";
import {
  useFinanceCategories,
  useFinanceCategoriesMeta,
} from "@/features/finance/hooks/use-finance-queries";
import { useTenantFinanceAccess } from "@/features/finance/hooks/use-tenant-finance-access";
import { ResourceIOToolbar } from "@/features/io";
import { useLocale } from "@/providers/locale-provider";

export function FinanceCategoriesPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { canWrite } = useTenantFinanceAccess(slug);
  const [createOpen, setCreateOpen] = useState(false);

  const listQuery = useFinanceCategories();
  const metaQuery = useFinanceCategoriesMeta();
  const columns = useFinanceCategoriesColumns();

  const items = useMemo(
    () => listQuery.data?.items ?? [],
    [listQuery.data?.items],
  );

  return (
    <EntityPage
      title={t("finance.categories.title")}
      description={t("finance.categories.subtitle")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        { label: t("finance.categories.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("finance.categories.create")}
          />
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={items}
        getRowId={(row) => row.uuid}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("finance.categories.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("finance.categories.empty")}
        emptyDescription={t("finance.categories.empty_description")}
        onRowClick={(row) =>
          router.push(routes.tenant.finance.categories.detail(slug, row.uuid))
        }
        features={{
          persistKey: `tenant-finance-categories-${slug}`,
          rowSelection: false,
          pagination: true,
        }}
        manual={{
          filtering: false,
          sorting: true,
          pagination: false,
        }}
        toolbarExtra={
          <>
            <ResourceIOToolbar
              resource="tenant.finance.categories"
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

      <FinanceCategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => void listQuery.refetch()}
      />
    </EntityPage>
  );
}
