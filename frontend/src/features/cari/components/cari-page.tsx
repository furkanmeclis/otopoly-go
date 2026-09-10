"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import {
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import { createColumn } from "@/components/tables";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import { routes } from "@/config/routes";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import {
  useCariAccounts,
  useCariMeta,
  useCariSummary,
} from "@/features/cari/hooks/use-cari";
import { useTenantCariAccess } from "@/features/cari/hooks/use-tenant-cari-access";
import type { CariAccount } from "@/features/cari/services/cari.service";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { ResourceIOToolbar } from "@/features/io";
import { useLocale } from "@/providers/locale-provider";

export function CariPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead } = useTenantCariAccess(slug);

  const listState = useServerListState({
    initialSort: "customer_name",
    initialPageSize: 20,
  });

  const listParams = useMemo(() => {
    const nameQ = columnTextValue(listState.columnFilters, "customer_name");
    return {
      ...listState.params,
      q: listState.params.q?.trim() || nameQ,
      is_active: columnSelectValue(listState.columnFilters, "is_active"),
      has_balance: columnSelectValue(listState.columnFilters, "has_balance"),
    };
  }, [listState.columnFilters, listState.params]);

  const listQuery = useCariAccounts(listParams);
  const summaryQuery = useCariSummary();
  const metaQuery = useCariMeta();

  const columns = useMemo<ColumnDef<CariAccount>[]>(
    () => [
      createColumn<CariAccount>({
        accessorKey: "customer_name",
        labelKey: "cari.customer_name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.customer_name}</span>
        ),
      }),
      createColumn<CariAccount>({
        accessorKey: "customer_phone",
        labelKey: "cari.customer_phone",
        cell: ({ row }) => row.original.customer_phone || "—",
      }),
      createColumn<CariAccount>({
        accessorKey: "balance",
        labelKey: "cari.balance",
        enableSorting: true,
        cell: ({ row }) => {
          const balance = parseFinanceAmount(row.original.balance);
          return (
            <span
              className={
                balance > 0
                  ? "font-medium text-amber-700 tabular-nums dark:text-amber-400"
                  : "tabular-nums"
              }
            >
              {formatFinanceAmount(
                row.original.balance,
                row.original.currency,
                locale,
              )}
            </span>
          );
        },
      }),
      createColumn<CariAccount>({
        accessorKey: "currency",
        labelKey: "cari.currency",
        cell: ({ row }) => row.original.currency,
      }),
      createColumn<CariAccount>({
        id: "is_active",
        labelKey: "common.status",
        accessorFn: (row) => (row.is_active ? "true" : "false"),
        filterVariant: "select",
        filterOptions: [
          { value: "true", labelKey: "common.active", label: "true" },
          { value: "false", labelKey: "common.passive", label: "false" },
        ],
        cell: ({ row }) => (
          <StatusChip
            label={
              row.original.is_active ? t("common.active") : t("common.passive")
            }
            tone={row.original.is_active ? "success" : "default"}
          />
        ),
      }),
      createColumn<CariAccount>({
        id: "has_balance",
        labelKey: "cari.has_balance",
        accessorFn: (row) =>
          parseFinanceAmount(row.balance) > 0 ? "true" : "false",
        filterVariant: "select",
        filterOptions: [
          { value: "true", labelKey: "cari.has_balance_yes", label: "true" },
          { value: "false", labelKey: "cari.has_balance_no", label: "false" },
        ],
        enableHiding: true,
        cell: () => null,
      }),
    ],
    [locale, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("cari.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  const summary = summaryQuery.data;
  const displayCurrency =
    listQuery.data?.items?.[0]?.currency ?? "TRY";

  return (
    <EntityPage
      title={t("cari.title")}
      description={t("cari.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        { label: t("cari.title") },
      ]}
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <DashboardStatCard
          label={t("cari.summary.total_receivable")}
          value={formatFinanceAmount(
            summary?.total_receivable,
            displayCurrency,
            locale,
          )}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("cari.summary.account_count")}
          value={summary?.account_count ?? 0}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("cari.summary.with_balance_count")}
          value={summary?.with_balance_count ?? 0}
          loading={summaryQuery.isLoading}
        />
      </div>

      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.cari.detail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("cari.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("cari.empty_title")}
        emptyDescription={t("cari.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: `tenant-cari-${slug}`,
          columnFilters: true,
        }}
        toolbarExtra={
          <>
            <ResourceIOToolbar
              resource="tenant.cari"
              query={{
                q: listParams.q,
                is_active: listParams.is_active,
                has_balance: listParams.has_balance,
                sort: listParams.sort,
              }}
              capabilities={metaQuery.data?.capabilities}
              jobsHref={routes.tenant.exports.root(slug)}
              scope="tenant"
            />
            <EntityToolbar
              onRefresh={() => {
                void listQuery.refetch();
                void summaryQuery.refetch();
              }}
              refreshDisabled={listQuery.isFetching || summaryQuery.isFetching}
            />
          </>
        }
      />
    </EntityPage>
  );
}
