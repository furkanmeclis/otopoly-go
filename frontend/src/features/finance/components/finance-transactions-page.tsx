"use client";

// TODO(finance): ResourceIOToolbar + bulk void when bulk-engine tenant finance adapter ships.

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import {
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { FinanceTransactionDialog } from "@/features/finance/components/finance-transaction-dialog";
import { useFinanceTransactionsColumns } from "@/features/finance/components/finance-transactions-columns";
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import {
  useFinanceAccounts,
  useFinanceCategories,
  useFinanceTransactions,
} from "@/features/finance/hooks/use-finance-queries";
import { useTenantFinanceAccess } from "@/features/finance/hooks/use-tenant-finance-access";
import type { FinanceTransaction } from "@/features/finance/services/finance.service";
import { useLocale } from "@/providers/locale-provider";
import type { ColumnFiltersState } from "@tanstack/react-table";

function columnSelectValue(columnFilters: ColumnFiltersState, id: string) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

function columnTextValue(columnFilters: ColumnFiltersState, id: string) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function columnDateRange(columnFilters: ColumnFiltersState, id: string) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value as
    [string | undefined, string | undefined] | undefined;
  return {
    from: raw?.[0]?.trim() || undefined,
    to: raw?.[1]?.trim() || undefined,
  };
}

export function FinanceTransactionsPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite } = useTenantFinanceAccess(slug);
  const { voidTransaction } = useFinanceMutations();

  const [incomeOpen, setIncomeOpen] = useState(
    () => searchParams.get("create") === "income",
  );
  const [expenseOpen, setExpenseOpen] = useState(
    () => searchParams.get("create") === "expense",
  );

  const listState = useServerListState({
    initialSort: "-transaction_date",
    initialPageSize: 25,
  });

  const accountsQuery = useFinanceAccounts({
    limit: 200,
    offset: 0,
    is_active: "true",
  });
  const categoriesQuery = useFinanceCategories();

  const filterOptions = useMemo(
    () => ({
      accounts: (accountsQuery.data?.items ?? []).map((account) => ({
        value: account.uuid,
        label: account.name,
      })),
      categories: (categoriesQuery.data?.items ?? []).map((category) => ({
        value: category.uuid,
        label: category.name,
      })),
    }),
    [accountsQuery.data?.items, categoriesQuery.data?.items],
  );

  const listParams = useMemo(() => {
    const { columnFilters } = listState;
    const dates = columnDateRange(columnFilters, "transaction_date");
    const descriptionQ = columnTextValue(columnFilters, "description");

    return {
      ...listState.params,
      q: listState.params.q?.trim() || descriptionQ || undefined,
      type: columnSelectValue(columnFilters, "type"),
      status: columnSelectValue(columnFilters, "status"),
      currency: columnTextValue(columnFilters, "currency"),
      date_from: dates.from,
      date_to: dates.to,
      account_uuid: columnSelectValue(columnFilters, "account_uuid"),
      category_uuid: columnSelectValue(columnFilters, "category_uuid"),
    };
  }, [listState]);

  const listQuery = useFinanceTransactions(listParams);

  const handleVoid = useCallback(
    (tx: FinanceTransaction) => {
      voidTransaction.mutate(tx.uuid);
    },
    [voidTransaction],
  );

  const columns = useFinanceTransactionsColumns(
    {
      canWrite,
      onVoid: handleVoid,
    },
    filterOptions,
  );

  const pageCount = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const size = listState.pagination.pageSize || 25;
    return Math.max(1, Math.ceil(total / size));
  }, [listQuery.data?.total, listState.pagination.pageSize]);

  return (
    <EntityPage
      title={t("finance.transactions.title")}
      description={t("finance.transactions.subtitle")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        { label: t("finance.transactions.title") },
      ]}
      actions={
        canWrite ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIncomeOpen(true)}
            >
              <ArrowDownLeft aria-hidden className="size-4" />
              {t("finance.actions.add_income")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpenseOpen(true)}
            >
              <ArrowUpRight aria-hidden className="size-4" />
              {t("finance.actions.add_expense")}
            </Button>
          </>
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("finance.transactions.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("finance.transactions.empty")}
        emptyDescription={t("finance.transactions.empty_description")}
        pageCount={pageCount}
        pageSizeOptions={[25, 50, 100]}
        state={listState.tableState}
        onRowClick={(row) =>
          router.push(routes.tenant.finance.transactions.detail(slug, row.uuid))
        }
        className="w-full min-w-0"
        features={{
          persistKey: `tenant-finance-transactions-v2-${slug}`,
          rowSelection: false,
          globalFilter: true,
          columnFilters: true,
          facetedFilters: false,
        }}
        manual={{
          filtering: true,
          sorting: true,
          pagination: true,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />

      <FinanceTransactionDialog
        type="income"
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        onSuccess={() => void listQuery.refetch()}
      />
      <FinanceTransactionDialog
        type="expense"
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        onSuccess={() => void listQuery.refetch()}
      />
    </EntityPage>
  );
}
