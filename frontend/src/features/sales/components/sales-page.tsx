"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ShoppingBag } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import { EntityActions, EntityPage, EntityToolbar } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import {
  financeToday,
  formatFinanceAmount,
} from "@/features/finance/lib/format";
import { ResourceIOToolbar } from "@/features/io";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import { QuickSaleDialog } from "@/features/sales/components/quick-sale-dialog";
import {
  useSales,
  useSalesMeta,
  useSalesSummary,
} from "@/features/sales/hooks/use-sales";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import type {
  Sale,
  SaleStatus,
} from "@/features/sales/services/sales.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUS_TABS = ["all", "posted", "voided"] as const;

function statusTone(status: SaleStatus) {
  switch (status) {
    case "posted":
      return "success" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function SalesPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantSalesAccess(slug);

  const [date, setDate] = useState(() => financeToday());
  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]>("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const listParams = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      sort: "-sold_at",
      q: q.trim() || undefined,
      status: statusTab === "all" ? undefined : statusTab,
      date_from: date || undefined,
      date_to: date || undefined,
    }),
    [date, q, statusTab],
  );

  const listQuery = useSales(listParams);
  const summaryQuery = useSalesSummary(date);
  const metaQuery = useSalesMeta();

  const applySearch = useCallback(() => {
    setQ(searchInput.trim());
  }, [searchInput]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("sales.forbidden")}
      />
    );
  }

  const summary = summaryQuery.data;
  const currency = listQuery.data?.items?.[0]?.currency ?? "TRY";
  const items = listQuery.data?.items ?? [];

  return (
    <EntityPage
      title={t("sales.title")}
      description={t("sales.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("sales.title") },
      ]}
      actions={
        canWrite ? (
          <EntityActions>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <ShoppingBag className="size-4" />
              {t("sales.quick.title")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DatePicker
          value={date}
          onChange={setDate}
          className="w-[11rem]"
          aria-label={t("sales.summary_date")}
        />
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applySearch();
            }}
            placeholder={t("sales.search_placeholder")}
            className="pl-9"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={applySearch}>
          {t("common.search")}
        </Button>
        <ResourceIOToolbar
          resource="tenant.sales"
          query={{
            q: listParams.q,
            status: listParams.status,
            date_from: listParams.date_from,
            date_to: listParams.date_to,
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
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <DashboardStatCard
          label={t("sales.summary.card_total")}
          value={formatFinanceAmount(summary?.card_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("sales.summary.cari_total")}
          value={formatFinanceAmount(summary?.cari_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("sales.summary.net_total")}
          value={formatFinanceAmount(summary?.net_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("sales.summary.paid_total")}
          value={formatFinanceAmount(summary?.paid_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("sales.summary.sale_count")}
          value={summary?.sale_count ?? 0}
          loading={summaryQuery.isLoading}
        />
      </div>

      <Tabs
        value={statusTab}
        onValueChange={(value) =>
          setStatusTab(value as (typeof STATUS_TABS)[number])
        }
        className="mb-4"
      >
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`sales.filter.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {listQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("sales.error_description")}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("sales.empty_title")}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((sale) => (
          <SaleCard
            key={sale.uuid}
            sale={sale}
            onOpen={() =>
              router.push(routes.tenant.sales.detail(slug, sale.uuid))
            }
          />
        ))}
      </div>

      <QuickSaleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(created) => {
          router.push(routes.tenant.sales.detail(slug, created.uuid));
        }}
      />
    </EntityPage>
  );
}

function SaleCard({
  sale,
  onOpen,
}: {
  sale: Sale;
  onOpen: () => void;
}) {
  const { t, locale } = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      <Card className="hover:border-primary/40 hover:bg-muted/20 h-full shadow-none transition-colors">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base font-semibold">
              {sale.customer_name || t("sales.walk_in")}
            </CardTitle>
            <p className="text-muted-foreground truncate text-sm">
              {t(`sales.payment_method.${sale.method}`)}
            </p>
          </div>
          <StatusChip
            label={t(`sales.status.${sale.status}`)}
            tone={statusTone(sale.status)}
          />
        </CardHeader>
        <CardContent className="space-y-1 pt-0 pb-4">
          <p className="text-muted-foreground text-xs">
            {sale.customer_phone || "—"}
          </p>
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {datetime(sale.sold_at, "dd.MM.yyyy HH:mm", locale)}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatFinanceAmount(sale.total_amount, sale.currency, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
