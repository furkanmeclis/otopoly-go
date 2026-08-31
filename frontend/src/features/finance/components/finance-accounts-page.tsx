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
import { routes } from "@/config/routes";
import { FinanceAccountDialog } from "@/features/finance/components/finance-account-dialog";
import { useFinanceAccountsColumns } from "@/features/finance/components/finance-accounts-columns";
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import {
  useFinanceAccounts,
  useFinanceAccountsMeta,
} from "@/features/finance/hooks/use-finance-queries";
import { useTenantFinanceAccess } from "@/features/finance/hooks/use-tenant-finance-access";
import type { FinanceAccount } from "@/features/finance/services/finance.service";
import { ResourceIOToolbar } from "@/features/io";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function FinanceAccountsPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canWrite } = useTenantFinanceAccess(slug);
  const { deleteAccount } = useFinanceMutations();
  const [createOpen, setCreateOpen] = useState(false);

  const listState = useServerListState({
    initialSort: "name",
    initialPageSize: 20,
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
      ...listState.params,
      ...(activeFilter ? { is_active: activeFilter } : {}),
    };
  }, [listState.columnFilters, listState.params]);

  const listQuery = useFinanceAccounts(listParams);
  const metaQuery = useFinanceAccountsMeta();

  const handleDelete = useCallback(
    async (account: FinanceAccount) => {
      const confirmed = await confirmDelete({
        title: t("finance.accounts.delete_title"),
        description: t("finance.accounts.delete_description", {
          name: account.name,
        }),
      });
      if (!confirmed) return;
      await deleteAccount.mutateAsync(account.uuid);
    },
    [confirmDelete, deleteAccount, t],
  );

  const columns = useFinanceAccountsColumns({
    canWrite,
    onDelete: handleDelete,
  });

  const pageCount = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const size = listState.pagination.pageSize || 20;
    return Math.max(1, Math.ceil(total / size));
  }, [listQuery.data?.total, listState.pagination.pageSize]);

  return (
    <EntityPage
      title={t("finance.accounts.title")}
      description={t("finance.accounts.subtitle")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        { label: t("finance.accounts.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("finance.accounts.create")}
          />
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("finance.accounts.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("finance.summary.no_accounts")}
        emptyDescription={t("finance.summary.no_accounts_description")}
        pageCount={pageCount}
        state={listState.tableState}
        onRowClick={(row) =>
          router.push(routes.tenant.finance.accounts.detail(slug, row.uuid))
        }
        features={{
          persistKey: `tenant-finance-accounts-${slug}`,
          rowSelection: false,
        }}
        toolbarExtra={
          <>
            <ResourceIOToolbar
              resource="tenant.finance.accounts"
              query={{
                q: listParams.q,
                is_active: listParams.is_active,
                sort: listParams.sort,
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

      <FinanceAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => void listQuery.refetch()}
      />
    </EntityPage>
  );
}
