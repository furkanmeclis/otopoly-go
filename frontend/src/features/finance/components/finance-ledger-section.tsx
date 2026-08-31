"use client";

// TODO(finance): Reuse useFinanceTransactionsColumns filterOptions for ledger parity with list page;
// optional date range props from parent detail pages.

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  EntitySectionCard,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { routes } from "@/config/routes";
import { useFinanceTransactionsColumns } from "@/features/finance/components/finance-transactions-columns";
import { useFinanceTransactions } from "@/features/finance/hooks/use-finance-queries";
import { useLocale } from "@/providers/locale-provider";

type FinanceLedgerSectionProps = {
  slug: string;
  title: string;
  accountUuid?: string;
  categoryUuid?: string;
  persistKey: string;
};

export function FinanceLedgerSection({
  slug,
  title,
  accountUuid,
  categoryUuid,
  persistKey,
}: FinanceLedgerSectionProps) {
  const { t } = useLocale();
  const router = useRouter();

  const listState = useServerListState({
    initialSort: "-transaction_date",
    initialPageSize: 15,
  });

  const listParams = useMemo(() => {
    const columnValue = (id: string) => {
      const raw = listState.columnFilters.find(
        (filter) => filter.id === id,
      )?.value;
      if (Array.isArray(raw)) return raw[0];
      return typeof raw === "string" ? raw : undefined;
    };

    return {
      ...listState.params,
      type: columnValue("type"),
      status: columnValue("status"),
      ...(accountUuid ? { account_uuid: accountUuid } : {}),
      ...(categoryUuid ? { category_uuid: categoryUuid } : {}),
    };
  }, [accountUuid, categoryUuid, listState.columnFilters, listState.params]);

  const listQuery = useFinanceTransactions(listParams);
  const columns = useFinanceTransactionsColumns({});

  const pageCount = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const size = listState.pagination.pageSize || 15;
    return Math.max(1, Math.ceil(total / size));
  }, [listQuery.data?.total, listState.pagination.pageSize]);

  return (
    <EntitySectionCard title={title} badge={listQuery.data?.total}>
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("finance.transactions.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("finance.transactions.empty")}
        emptyDescription={t("finance.detail.ledger_empty")}
        pageCount={pageCount}
        state={listState.tableState}
        onRowClick={(row) =>
          router.push(routes.tenant.finance.transactions.detail(slug, row.uuid))
        }
        features={{
          persistKey,
          rowSelection: false,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
    </EntitySectionCard>
  );
}
