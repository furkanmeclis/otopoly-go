"use client";

// TODO(finance): Multi-currency summary when org has mixed account currencies; cash-flow forecast widget;
// drill-down from expense breakdown to category detail with period preserved in URL.

import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Landmark,
  PieChart,
  Plus,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import {
  financeMonthStart,
  financeToday,
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { accountTypeLabelKey } from "@/features/finance/lib/labels";
import { FinanceQuickLinks } from "@/features/finance/components/finance-quick-links";
import { FinanceRecentTransactions } from "@/features/finance/components/finance-recent-transactions";
import { FinanceTransactionDialog } from "@/features/finance/components/finance-transaction-dialog";
import { FinanceTransferDialog } from "@/features/finance/components/finance-transfer-dialog";
import { useFinanceSummary } from "@/features/finance/hooks/use-finance-queries";
import { useTenantFinanceAccess } from "@/features/finance/hooks/use-tenant-finance-access";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

function accountIcon(type: string) {
  return type === "bank" ? Landmark : Wallet;
}

export function FinanceSummaryPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const searchParams = useSearchParams();
  const { canWrite } = useTenantFinanceAccess(slug);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(
    () => searchParams.get("transfer") === "1",
  );
  const [dateFrom, setDateFrom] = useState(financeMonthStart);
  const [dateTo, setDateTo] = useState(financeToday);
  const [appliedRange, setAppliedRange] = useState({
    date_from: financeMonthStart(),
    date_to: financeToday(),
  });

  const summaryQuery = useFinanceSummary(appliedRange);
  const summary = summaryQuery.data;
  const displayCurrency = summary?.currency ?? "TRY";

  const refreshSummary = () => void summaryQuery.refetch();

  const expenseMax = useMemo(() => {
    const totals = summary?.expense_by_category ?? [];
    return totals.reduce(
      (max, row) => Math.max(max, parseFinanceAmount(row.total)),
      0,
    );
  }, [summary?.expense_by_category]);

  const totalCash = useMemo(() => {
    return (summary?.accounts ?? []).reduce(
      (sum, account) => sum + parseFinanceAmount(account.current_balance),
      0,
    );
  }, [summary?.accounts]);

  const netValue = parseFinanceAmount(summary?.net);
  const incomeValue = parseFinanceAmount(summary?.total_income);
  const expenseValue = parseFinanceAmount(summary?.total_expense);
  const flowTotal = incomeValue + expenseValue;
  const expenseShare =
    flowTotal > 0 ? Math.round((expenseValue / flowTotal) * 100) : 0;

  const breadcrumbs = [
    { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
    { label: t("layout.nav_finance") },
  ];

  const headerActions = canWrite ? (
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
      <Button type="button" size="sm" onClick={() => setTransferOpen(true)}>
        <ArrowRightLeft aria-hidden className="size-4" />
        {t("finance.actions.transfer")}
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("finance.title")}
        description={t("finance.subtitle")}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <Card className="mb-6 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {t("finance.summary.period")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="summary_date_from">
                {t("finance.summary.date_from")}
              </Label>
              <DatePicker
                id="summary_date_from"
                value={dateFrom}
                onChange={(value) => setDateFrom(value ?? financeMonthStart())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary_date_to">
                {t("finance.summary.date_to")}
              </Label>
              <DatePicker
                id="summary_date_to"
                value={dateTo}
                onChange={(value) => setDateTo(value ?? financeToday())}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setAppliedRange({ date_from: dateFrom, date_to: dateTo })
              }
            >
              {t("finance.summary.apply_filter")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const from = financeMonthStart();
                const to = financeToday();
                setDateFrom(from);
                setDateTo(to);
                setAppliedRange({ date_from: from, date_to: to });
              }}
            >
              {t("finance.summary.reset_filter")}
            </Button>
          </div>
          {summary ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {t("finance.summary.period_label", {
                from: summary.date_from,
                to: summary.date_to,
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {summaryQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={
            isApiError(summaryQuery.error)
              ? summaryQuery.error.message
              : t("finance.summary.error_description")
          }
          onRetry={() => void summaryQuery.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardStatCard
              label={t("finance.summary.income")}
              value={formatFinanceAmount(
                summary?.total_income,
                displayCurrency,
                locale,
              )}
              loading={summaryQuery.isLoading}
              className="border-emerald-500/20 bg-emerald-500/5"
            />
            <DashboardStatCard
              label={t("finance.summary.expense")}
              value={formatFinanceAmount(
                summary?.total_expense,
                displayCurrency,
                locale,
              )}
              loading={summaryQuery.isLoading}
              className="border-rose-500/20 bg-rose-500/5"
            />
            <DashboardStatCard
              label={t("finance.summary.net")}
              value={
                <span
                  className={cn(
                    netValue >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatFinanceAmount(summary?.net, displayCurrency, locale)}
                </span>
              }
              loading={summaryQuery.isLoading}
            />
            <DashboardStatCard
              label={t("finance.summary.total_cash")}
              value={formatFinanceAmount(
                String(totalCash.toFixed(2)),
                displayCurrency,
                locale,
              )}
              href={routes.tenant.finance.accounts.root(slug)}
              loading={summaryQuery.isLoading}
            />
          </div>

          {!summaryQuery.isLoading && flowTotal > 0 ? (
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">
                  {t("finance.summary.flow_mix")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex h-3 overflow-hidden rounded-full">
                  <div
                    className="bg-emerald-500 transition-[width]"
                    style={{ width: `${100 - expenseShare}%` }}
                    title={t("finance.summary.income")}
                  />
                  <div
                    className="bg-rose-500 transition-[width]"
                    style={{ width: `${expenseShare}%` }}
                    title={t("finance.summary.expense")}
                  />
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
                  <span>
                    {t("finance.summary.income")}:{" "}
                    <strong className="text-foreground">
                      {formatFinanceAmount(
                        summary?.total_income,
                        displayCurrency,
                        locale,
                      )}
                    </strong>
                  </span>
                  <span>
                    {t("finance.summary.expense")}:{" "}
                    <strong className="text-foreground">
                      {formatFinanceAmount(
                        summary?.total_expense,
                        displayCurrency,
                        locale,
                      )}
                    </strong>
                  </span>
                  <span>
                    {t("finance.summary.expense_share")}:{" "}
                    <strong className="text-foreground">%{expenseShare}</strong>
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <PieChart
                    aria-hidden
                    className="text-muted-foreground size-4"
                  />
                  {t("finance.summary.expense_breakdown")}
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href={routes.tenant.finance.categories.root(slug)}>
                    {t("finance.summary.manage_categories")}
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {summaryQuery.isLoading ? (
                  <>
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </>
                ) : (summary?.expense_by_category ?? []).length ? (
                  summary?.expense_by_category.map((row) => {
                    const amount = parseFinanceAmount(row.total);
                    const width =
                      expenseMax > 0
                        ? Math.max(4, (amount / expenseMax) * 100)
                        : 0;
                    return (
                      <Link
                        key={row.category_uuid}
                        href={routes.tenant.finance.categories.detail(
                          slug,
                          row.category_uuid,
                        )}
                        className="hover:bg-muted/30 block space-y-1.5 rounded-lg p-2 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium">
                            {row.category_name}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatFinanceAmount(
                              row.total,
                              displayCurrency,
                              locale,
                            )}
                          </span>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full transition-[width]"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <EmptyState
                    title={t("finance.summary.expense_breakdown_empty")}
                    description={t(
                      "finance.summary.expense_breakdown_empty_description",
                    )}
                    action={
                      canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setExpenseOpen(true)}
                        >
                          <Plus aria-hidden className="size-4" />
                          {t("finance.actions.add_expense")}
                        </Button>
                      ) : undefined
                    }
                    className="py-10"
                  />
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Wallet
                    aria-hidden
                    className="text-muted-foreground size-4"
                  />
                  {t("finance.summary.accounts")}
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href={routes.tenant.finance.accounts.root(slug)}>
                    {t("finance.summary.view_accounts")}
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {summaryQuery.isLoading ? (
                  <>
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </>
                ) : (summary?.accounts ?? []).length ? (
                  summary?.accounts.map((account) => {
                    const Icon = accountIcon(account.type);
                    return (
                      <Link
                        key={account.uuid}
                        href={routes.tenant.finance.accounts.detail(
                          slug,
                          account.uuid,
                        )}
                        className="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                            <Icon aria-hidden className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {account.name}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {t(accountTypeLabelKey(account.type))} ·{" "}
                              {account.currency}
                              {account.is_default
                                ? ` · ${t("finance.accounts.default")}`
                                : ""}
                            </div>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "shrink-0 text-right font-semibold tabular-nums",
                            account.negative_balance && "text-destructive",
                          )}
                        >
                          {formatFinanceAmount(
                            account.current_balance,
                            account.currency,
                            locale,
                          )}
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <EmptyState
                    title={t("finance.summary.no_accounts")}
                    description={t("finance.summary.no_accounts_description")}
                    action={
                      canWrite ? (
                        <Button asChild size="sm">
                          <Link
                            href={routes.tenant.finance.accounts.root(slug)}
                          >
                            {t("finance.accounts.create")}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                    className="py-10"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={routes.tenant.finance.transactions.root(slug)}>
                {t("finance.summary.view_transactions")}
              </Link>
            </Button>
          </div>

          <FinanceRecentTransactions
            slug={slug}
            dateFrom={appliedRange.date_from}
            dateTo={appliedRange.date_to}
          />

          <FinanceQuickLinks slug={slug} />
        </div>
      )}

      <FinanceTransactionDialog
        type="income"
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        onSuccess={refreshSummary}
      />
      <FinanceTransactionDialog
        type="expense"
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        onSuccess={refreshSummary}
      />
      <FinanceTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onSuccess={refreshSummary}
      />
    </>
  );
}
