"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BarChart3,
  ShoppingBag,
  Users,
  Wallet,
} from "lucide-react";

import { AppChart } from "@/components/charts/app-chart";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import {
  financeMonthStart,
  financeToday,
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { ResourceIOToolbar } from "@/features/io/components/resource-io-toolbar";
import {
  useReportsMeta,
  useReportsOverview,
} from "@/features/reports/hooks/use-reports";
import { useTenantReportsAccess } from "@/features/reports/hooks/use-tenant-reports-access";
import type { ReportsOverviewFilters } from "@/features/reports/services/reports.service";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type DraftFilters = {
  date_from: string;
  date_to: string;
  currency: string;
  payment_method: string;
  account_uuid: string;
  source_type: string;
  granularity: string;
};

function toQuery(draft: DraftFilters): ReportsOverviewFilters {
  return {
    date_from: draft.date_from,
    date_to: draft.date_to,
    currency: draft.currency || undefined,
    payment_method:
      draft.payment_method && draft.payment_method !== "all"
        ? draft.payment_method
        : undefined,
    account_uuid: draft.account_uuid || undefined,
    source_type:
      draft.source_type && draft.source_type !== "all"
        ? draft.source_type
        : undefined,
    granularity: draft.granularity || "day",
  };
}

export function ReportsPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canExport } = useTenantReportsAccess(slug);
  const [draft, setDraft] = useState<DraftFilters>({
    date_from: financeMonthStart(),
    date_to: financeToday(),
    currency: "",
    payment_method: "all",
    account_uuid: "",
    source_type: "all",
    granularity: "day",
  });
  const [applied, setApplied] = useState(() => toQuery(draft));

  const overviewQuery = useReportsOverview(applied);
  const metaQuery = useReportsMeta();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const overview = overviewQuery.data;
  const currency = overview?.filters.currency ?? "TRY";
  const money = (v?: string) => formatFinanceAmount(v, currency, locale);
  const moneyTick = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const sourceLabel = (sourceType: string, type: string) => {
    const sourceKey = sourceType
      ? `reports.source.${sourceType}`
      : "reports.source.unknown";
    const sourceText = (() => {
      const translated = t(sourceKey);
      return translated === sourceKey
        ? sourceType || t("reports.source.unknown")
        : translated;
    })();
    const typeKey = `reports.type.${type}`;
    const typeText = (() => {
      const translated = t(typeKey);
      return translated === typeKey ? type : translated;
    })();
    return `${sourceText} · ${typeText}`;
  };

  const timeseriesData = useMemo(
    () =>
      (overview?.timeseries ?? []).map((p) => ({
        label: p.date,
        income: parseFinanceAmount(p.income),
        expense: parseFinanceAmount(p.expense),
        net: parseFinanceAmount(p.net),
        jobs: parseFinanceAmount(p.job_paid),
      })),
    [overview?.timeseries],
  );

  const paymentChart = useMemo(
    () =>
      (overview?.payments_by_method ?? []).map((p) => {
        const key = `reports.method.${p.name}`;
        const label = t(key);
        return {
          label: label === key ? p.name : label,
          value: parseFinanceAmount(p.total),
        };
      }),
    [overview?.payments_by_method, t],
  );

  const serviceChart = useMemo(
    () =>
      (overview?.services ?? []).slice(0, 8).map((p) => ({
        label: p.name,
        value: parseFinanceAmount(p.total),
      })),
    [overview?.services],
  );

  const productChart = useMemo(
    () =>
      (overview?.products ?? []).slice(0, 8).map((p) => ({
        label: p.name,
        value: parseFinanceAmount(p.total),
      })),
    [overview?.products],
  );

  const expenseChart = useMemo(
    () =>
      (overview?.expenses_by_category ?? []).map((p) => ({
        label: p.name,
        value: parseFinanceAmount(p.total),
      })),
    [overview?.expenses_by_category],
  );

  const applyPreset = (from: string, to: string) => {
    const next = { ...draft, date_from: from, date_to: to };
    setDraft(next);
    setApplied(toQuery(next));
  };

  const breadcrumbs = [
    { label: t("layout.nav_reports"), href: routes.tenant.reports.root(slug) },
  ];

  const exportQuery: Record<string, string | undefined> = {
    date_from: applied.date_from,
    date_to: applied.date_to,
    currency: applied.currency,
    payment_method: applied.payment_method,
    account_uuid: applied.account_uuid,
    source_type: applied.source_type,
    granularity: applied.granularity,
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canExport && metaQuery.data?.capabilities ? (
        <ResourceIOToolbar
          resource="tenant.reports"
          query={exportQuery}
          capabilities={metaQuery.data.capabilities}
          scope="tenant"
          jobsHref={routes.tenant.exports.root(slug)}
        />
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <Card className="mb-6 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {t("reports.filters.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset(financeToday(), financeToday())}
            >
              {t("reports.filters.preset_today")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset(daysAgo(6), financeToday())}
            >
              {t("reports.filters.preset_7d")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset(daysAgo(29), financeToday())}
            >
              {t("reports.filters.preset_30d")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset(financeMonthStart(), financeToday())}
            >
              {t("reports.filters.preset_month")}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>{t("reports.filters.date_from")}</Label>
              <DatePicker
                value={draft.date_from}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    date_from: v ?? financeMonthStart(),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.date_to")}</Label>
              <DatePicker
                value={draft.date_to}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, date_to: v ?? financeToday() }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.currency")}</Label>
              <Select
                value={draft.currency || "all"}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    currency: v === "all" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.filters.currency_all")}
                  </SelectItem>
                  <SelectItem value="TRY">TRY</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.payment_method")}</Label>
              <Select
                value={draft.payment_method}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, payment_method: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.filters.payment_all")}
                  </SelectItem>
                  <SelectItem value="cash">
                    {t("reports.method.cash")}
                  </SelectItem>
                  <SelectItem value="card">
                    {t("reports.method.card")}
                  </SelectItem>
                  <SelectItem value="cari">
                    {t("reports.method.cari")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.source_type")}</Label>
              <Select
                value={draft.source_type}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, source_type: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.filters.source_all")}
                  </SelectItem>
                  <SelectItem value="manual">
                    {t("reports.source.manual")}
                  </SelectItem>
                  <SelectItem value="service_job">
                    {t("reports.source.service_job")}
                  </SelectItem>
                  <SelectItem value="product_sale">
                    {t("reports.source.product_sale")}
                  </SelectItem>
                  <SelectItem value="purchase">
                    {t("reports.source.purchase")}
                  </SelectItem>
                  <SelectItem value="cari_payment">
                    {t("reports.source.cari_payment")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.account")}</Label>
              <Select
                value={draft.account_uuid || "all"}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    account_uuid: v === "all" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.filters.account_all")}
                  </SelectItem>
                  {(accountsQuery.data?.items ?? []).map((a) => (
                    <SelectItem key={a.uuid} value={a.uuid}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("reports.filters.granularity")}</Label>
              <Select
                value={draft.granularity}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, granularity: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">
                    {t("reports.filters.granularity_day")}
                  </SelectItem>
                  <SelectItem value="week">
                    {t("reports.filters.granularity_week")}
                  </SelectItem>
                  <SelectItem value="month">
                    {t("reports.filters.granularity_month")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setApplied(toQuery(draft))}>
              {t("reports.filters.apply")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const next: DraftFilters = {
                  date_from: financeMonthStart(),
                  date_to: financeToday(),
                  currency: "",
                  payment_method: "all",
                  account_uuid: "",
                  source_type: "all",
                  granularity: "day",
                };
                setDraft(next);
                setApplied(toQuery(next));
              }}
            >
              {t("reports.filters.reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {overviewQuery.isError ? (
        <ErrorState
          title={t("reports.error")}
          description={
            isApiError(overviewQuery.error)
              ? overviewQuery.error.message
              : undefined
          }
          onRetry={() => void overviewQuery.refetch()}
        />
      ) : null}

      {overviewQuery.isLoading && !overview ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : null}

      {overview ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardStatCard
              label={t("reports.kpis.income")}
              value={money(overview.kpis.total_income)}
            />
            <DashboardStatCard
              label={t("reports.kpis.expense")}
              value={money(overview.kpis.total_expense)}
            />
            <DashboardStatCard
              label={t("reports.kpis.net")}
              value={money(overview.kpis.net_profit)}
            />
            <DashboardStatCard
              label={t("reports.kpis.jobs_paid")}
              value={`${overview.kpis.job_paid_count} · ${money(overview.kpis.job_paid_total)}`}
            />
            <DashboardStatCard
              label={t("reports.kpis.avg_ticket")}
              value={money(overview.kpis.avg_ticket)}
            />
            <DashboardStatCard
              label={t("reports.kpis.vehicles")}
              value={String(overview.kpis.vehicles_served)}
            />
            <DashboardStatCard
              label={t("reports.kpis.sales")}
              value={`${overview.kpis.sale_count} · ${money(overview.kpis.sale_total)}`}
            />
            <DashboardStatCard
              label={t("reports.kpis.purchases")}
              value={`${overview.kpis.purchase_count} · ${money(overview.kpis.purchase_total)}`}
            />
            <DashboardStatCard
              label={t("reports.kpis.cari_charged")}
              value={money(overview.kpis.cari_charged)}
            />
            <DashboardStatCard
              label={t("reports.kpis.cari_collected")}
              value={money(overview.kpis.cari_collected)}
            />
            <DashboardStatCard
              label={t("reports.kpis.cari_outstanding")}
              value={money(overview.kpis.cari_outstanding)}
            />
            <DashboardStatCard
              label={t("reports.kpis.cash")}
              value={money(overview.kpis.cash_total)}
            />
            <DashboardStatCard
              label={t("reports.kpis.card")}
              value={money(overview.kpis.card_total)}
            />
            <DashboardStatCard
              label={t("reports.kpis.cari_pay")}
              value={money(overview.kpis.cari_payment_total)}
            />
          </div>

          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <AppChart
              type="composed"
              title={t("reports.charts.cashflow")}
              description={t("reports.charts.cashflow_desc")}
              data={timeseriesData}
              categoryKey="label"
              series={[
                { key: "income", type: "bar" },
                { key: "expense", type: "bar" },
                { key: "net", type: "line" },
              ]}
              config={{
                income: {
                  label: t("reports.kpis.income"),
                  color: "var(--chart-1)",
                },
                expense: {
                  label: t("reports.kpis.expense"),
                  color: "var(--chart-2)",
                },
                net: { label: t("reports.kpis.net"), color: "var(--chart-3)" },
              }}
              valueFormatter={(v) => money(String(v))}
              tickValueFormatter={moneyTick}
              emptyTitle={t("reports.empty")}
              height={320}
            />
            <AppChart
              type="donut"
              title={t("reports.charts.payments")}
              description={t("reports.charts.payments_desc")}
              data={paymentChart}
              categoryKey="label"
              series={["value"]}
              config={{
                value: {
                  label: t("reports.tables.total"),
                  color: "var(--chart-1)",
                },
              }}
              valueFormatter={(v) => money(String(v))}
              emptyTitle={t("reports.empty")}
              height={320}
            />
            <AppChart
              type="bar-horizontal"
              title={t("reports.charts.services")}
              description={t("reports.charts.services_desc")}
              data={serviceChart}
              categoryKey="label"
              series={["value"]}
              config={{
                value: {
                  label: t("reports.tables.total"),
                  color: "var(--chart-4)",
                },
              }}
              valueFormatter={(v) => money(String(v))}
              tickValueFormatter={moneyTick}
              emptyTitle={t("reports.empty")}
              height={320}
            />
            <AppChart
              type="bar-horizontal"
              title={t("reports.charts.products")}
              description={t("reports.charts.products_desc")}
              data={productChart}
              categoryKey="label"
              series={["value"]}
              config={{
                value: {
                  label: t("reports.tables.total"),
                  color: "var(--chart-5)",
                },
              }}
              valueFormatter={(v) => money(String(v))}
              tickValueFormatter={moneyTick}
              emptyTitle={t("reports.empty")}
              height={320}
            />
            <AppChart
              type="pie"
              title={t("reports.charts.expenses")}
              data={expenseChart}
              categoryKey="label"
              series={["value"]}
              config={{
                value: {
                  label: t("reports.tables.total"),
                  color: "var(--chart-2)",
                },
              }}
              valueFormatter={(v) => money(String(v))}
              emptyTitle={t("reports.empty")}
              height={320}
            />
            <AppChart
              type="bar-horizontal"
              title={t("reports.charts.sources")}
              data={(overview.revenue_by_source ?? []).map((r) => ({
                label: sourceLabel(r.source_type, r.type),
                value: parseFinanceAmount(r.total),
              }))}
              categoryKey="label"
              series={["value"]}
              config={{
                value: {
                  label: t("reports.tables.total"),
                  color: "var(--chart-3)",
                },
              }}
              valueFormatter={(v) => money(String(v))}
              tickValueFormatter={moneyTick}
              emptyTitle={t("reports.empty")}
              height={320}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <NamedTable
              title={t("reports.tables.services")}
              icon={<BarChart3 className="size-4" />}
              rows={overview.services}
              money={money}
              t={t}
            />
            <NamedTable
              title={t("reports.tables.products")}
              icon={<ShoppingBag className="size-4" />}
              rows={overview.products}
              money={money}
              t={t}
              showQty
            />
            <NamedTable
              title={t("reports.tables.expenses")}
              icon={<ArrowUpRight className="size-4" />}
              rows={overview.expenses_by_category}
              money={money}
              t={t}
            />
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Wallet className="size-4" />
                  {t("reports.tables.cari")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!overview.cari_receivables.length ? (
                  <EmptyState title={t("reports.empty")} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left">
                          <th className="py-2 pr-3 font-medium">
                            {t("reports.tables.name")}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t("reports.tables.phone")}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t("reports.tables.balance")}
                          </th>
                          <th className="py-2 font-medium">
                            {t("reports.tables.last_entry")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.cari_receivables.map((row) => (
                          <tr
                            key={row.account_uuid}
                            className="border-b last:border-0"
                          >
                            <td className="py-2 pr-3">{row.customer_name}</td>
                            <td className="py-2 pr-3">
                              {row.customer_phone || "—"}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {formatFinanceAmount(
                                row.balance,
                                row.currency,
                                locale,
                              )}
                            </td>
                            <td className="py-2">
                              {row.last_entry_date ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="shadow-none xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Users className="size-4" />
                  {t("reports.tables.customers")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!overview.top_customers.length ? (
                  <EmptyState title={t("reports.empty")} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left">
                          <th className="py-2 pr-3 font-medium">
                            {t("reports.tables.name")}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t("reports.tables.count")}
                          </th>
                          <th className="py-2 font-medium">
                            {t("reports.tables.total")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.top_customers.map((row) => (
                          <tr
                            key={row.customer_uuid}
                            className="border-b last:border-0"
                          >
                            <td className="py-2 pr-3">{row.customer_name}</td>
                            <td className="py-2 pr-3 tabular-nums">
                              {row.job_count}
                            </td>
                            <td className="py-2 tabular-nums">
                              {money(row.job_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

function NamedTable({
  title,
  icon,
  rows,
  money,
  t,
  showQty,
}: {
  title: string;
  icon: ReactNode;
  rows: { name: string; total: string; count: number; qty?: string }[];
  money: (v?: string) => string;
  t: (key: string) => string;
  showQty?: boolean;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <EmptyState title={t("reports.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-3 font-medium">
                    {t("reports.tables.name")}
                  </th>
                  {showQty ? (
                    <th className="py-2 pr-3 font-medium">
                      {t("reports.tables.qty")}
                    </th>
                  ) : null}
                  <th className="py-2 pr-3 font-medium">
                    {t("reports.tables.count")}
                  </th>
                  <th className="py-2 font-medium">
                    {t("reports.tables.total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-b last:border-0">
                    <td className="py-2 pr-3">{row.name}</td>
                    {showQty ? (
                      <td className="py-2 pr-3 tabular-nums">
                        {row.qty ?? "—"}
                      </td>
                    ) : null}
                    <td className="py-2 pr-3 tabular-nums">{row.count}</td>
                    <td className="py-2 tabular-nums">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
