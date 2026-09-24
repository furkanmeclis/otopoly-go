"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CarFront,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileSignature,
  KeyRound,
  MessageCircle,
  Plus,
  ShoppingBag,
  Sparkles,
  UserPlus,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { AppChart } from "@/components/charts/app-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { useCatalogServices } from "@/features/catalog/hooks/use-catalog-queries";
import { useContractTemplates } from "@/features/contracts/hooks/use-contracts";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { JobElapsed } from "@/features/jobs/components/job-elapsed";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { useJobs, useJobsSummary } from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import { isStale, localToday, shiftDate } from "@/features/jobs/lib/job-ui";
import { useWhatsAppSession } from "@/features/messaging/hooks/use-messaging";
import { useTenant } from "@/features/organizations/providers/tenant-provider";
import { useReportsOverview } from "@/features/reports/hooks/use-reports";
import { useTenantReportsAccess } from "@/features/reports/hooks/use-tenant-reports-access";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

const CHART_DAYS = 14;

/** Same params as the operations board so both pages share the cache. */
function todayJobsParams(date: string) {
  return {
    limit: 100,
    offset: 0,
    sort: "-started_at",
    date_from: date,
    date_to: date,
  };
}

function greetingKey(hour: number) {
  if (hour < 12) return "dashboard.tenant.greeting_morning";
  if (hour < 18) return "dashboard.tenant.greeting_day";
  return "dashboard.tenant.greeting_evening";
}

export function TenantDashboard({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { organization } = useTenant();
  const { user } = useAuth();
  const jobsAccess = useTenantJobsAccess(slug);
  const reportsAccess = useTenantReportsAccess(slug);
  const salesAccess = useTenantSalesAccess(slug);
  const searchParams = useSearchParams();
  const firstName = user?.fullName?.split(" ")[0] ?? "";
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            {datetime(now.toISOString(), "EEEE, d MMMM yyyy", locale)}
          </p>
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {firstName
              ? t(greetingKey(now.getHours()), { name: firstName })
              : (organization?.name ?? t("organizations.home.title"))}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("dashboard.tenant.subtitle", { org: organization?.name ?? "" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {jobsAccess.canWrite ? (
            <Button asChild size="sm">
              <Link href={`${routes.tenant.operations.root(slug)}?new=1`}>
                <Plus className="size-4" />
                {t("jobs.actions.create")}
              </Link>
            </Button>
          ) : null}
          {salesAccess.canWrite ? (
            <Button asChild size="sm" variant="outline">
              <Link href={routes.tenant.sales.root(slug)}>
                <ShoppingBag className="size-4" />
                {t("sales.quick.title")}
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={routes.tenant.customers.root(slug)}>
              <UserPlus className="size-4" />
              {t("dashboard.tenant.customers")}
            </Link>
          </Button>
        </div>
      </header>

      {reportsAccess.isOwner ? (
        <SetupChecklist
          slug={slug}
          welcome={searchParams.get("welcome") === "1"}
        />
      ) : null}

      {jobsAccess.canRead ? <TodaySection slug={slug} /> : null}

      {reportsAccess.canRead ? <InsightsSection slug={slug} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- today */

function TodaySection({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const today = localToday();
  const jobsQuery = useJobs(todayJobsParams(today), {
    refetchInterval: 30_000,
  });
  const summaryQuery = useJobsSummary(today);
  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data]);
  const nowMs = jobsQuery.dataUpdatedAt || 0;
  const currency = jobs[0]?.currency ?? "TRY";
  const loading = jobsQuery.isLoading;

  const inProgress = jobs.filter((j) => j.status === "in_progress");
  const ready = jobs.filter((j) => j.status === "ready");
  const delivered = jobs.filter((j) => j.status === "delivered");
  const unpaidDelivered = delivered.filter(
    (j) => j.payment_status === "unpaid",
  );
  const stale = inProgress.filter((j) => isStale(j, nowMs));
  const queue = [...ready, ...inProgress].slice(0, 6);
  const opsHref = routes.tenant.operations.root(slug);

  const tiles: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    hint?: string;
    tone: string;
    warn?: boolean;
  }> = [
    {
      icon: Wrench,
      label: t("jobs.status.in_progress"),
      value: String(inProgress.length),
      hint: stale.length
        ? t("dashboard.tenant.stale", { count: stale.length })
        : undefined,
      tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      warn: stale.length > 0,
    },
    {
      icon: KeyRound,
      label: t("jobs.status.ready"),
      value: String(ready.length),
      hint: ready.length ? t("dashboard.tenant.ready_hint") : undefined,
      tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
    {
      icon: CarFront,
      label: t("dashboard.tenant.delivered_today"),
      value: String(delivered.length),
      hint: unpaidDelivered.length
        ? t("dashboard.tenant.unpaid", { count: unpaidDelivered.length })
        : undefined,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      warn: unpaidDelivered.length > 0,
    },
    {
      icon: Wallet,
      label: t("dashboard.tenant.collected_today"),
      value: formatFinanceAmount(
        summaryQuery.data?.paid_total,
        currency,
        locale,
      ),
      hint: t("dashboard.tenant.card_cari", {
        card: formatFinanceAmount(
          summaryQuery.data?.card_total,
          currency,
          locale,
        ),
        cari: formatFinanceAmount(
          summaryQuery.data?.cari_total,
          currency,
          locale,
        ),
      }),
      tone: "bg-primary/10 text-primary",
    },
  ];

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_minmax(0,24rem)]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={opsHref}
            className="group bg-card hover:border-primary/40 flex flex-col rounded-2xl border p-4 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-xl",
                  tile.tone,
                )}
              >
                <tile.icon className="size-4" />
              </span>
              <ArrowRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="text-muted-foreground mt-3 text-xs font-medium">
              {tile.label}
            </p>
            {loading || summaryQuery.isLoading ? (
              <Skeleton className="mt-1 h-7 w-20" />
            ) : (
              <p className="font-display mt-0.5 truncate text-2xl font-semibold tabular-nums">
                {tile.value}
              </p>
            )}
            {tile.hint ? (
              <p
                className={cn(
                  "mt-1 truncate text-xs",
                  tile.warn
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {tile.hint}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="bg-card flex flex-col rounded-2xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {t("dashboard.tenant.queue")}
          </h2>
          <Link
            href={opsHref}
            className="text-primary text-xs font-medium hover:underline"
          >
            {t("dashboard.tenant.open_board")}
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <p className="text-muted-foreground m-auto px-6 py-8 text-center text-sm">
            {t("dashboard.tenant.queue_empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {queue.map((job) => (
              <li key={job.uuid}>
                <Link
                  href={routes.tenant.operations.detail(slug, job.uuid)}
                  className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
                >
                  <PlateBadge plate={job.plate} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {job.customer_name}
                  </span>
                  {job.status === "ready" ? (
                    <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                      {t("jobs.status.ready")}
                    </span>
                  ) : (
                    <JobElapsed
                      startedAt={job.started_at}
                      now={nowMs}
                      stale={isStale(job, nowMs)}
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- insights */

function InsightsSection({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const today = localToday();
  const overviewQuery = useReportsOverview({
    date_from: shiftDate(today, -(CHART_DAYS - 1)),
    date_to: today,
    granularity: "day",
  });
  const overview = overviewQuery.data;
  const kpis = overview?.kpis;
  const currency = "TRY";
  const money = (v?: string | number) =>
    formatFinanceAmount(v, currency, locale);
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const chartData = useMemo(
    () =>
      (overview?.timeseries ?? []).map((point) => ({
        label: point.date,
        income: parseFinanceAmount(point.income),
        jobs: point.job_count,
      })),
    [overview?.timeseries],
  );

  const services = (overview?.services ?? []).slice(0, 5);
  const serviceMax = Math.max(
    1,
    ...services.map((s) => parseFinanceAmount(s.total)),
  );
  const customers = (overview?.top_customers ?? []).slice(0, 5);
  const receivables = (overview?.cari_receivables ?? []).slice(0, 5);

  const kpiItems = [
    {
      label: t("dashboard.tenant.kpi_income"),
      value: money(kpis?.total_income),
    },
    { label: t("dashboard.tenant.kpi_net"), value: money(kpis?.net_profit) },
    {
      label: t("dashboard.tenant.kpi_vehicles"),
      value: String(kpis?.vehicles_served ?? 0),
    },
    { label: t("dashboard.tenant.kpi_ticket"), value: money(kpis?.avg_ticket) },
  ];

  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[1fr_minmax(0,24rem)]">
        <div className="bg-card rounded-2xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                {t("dashboard.tenant.revenue_title", { days: CHART_DAYS })}
              </h2>
              <p className="text-muted-foreground text-xs">
                {t("dashboard.tenant.revenue_desc")}
              </p>
            </div>
            <Link
              href={routes.tenant.reports.root(slug)}
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("dashboard.tenant.open_reports")}
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpiItems.map((item) => (
              <div
                key={item.label}
                className="bg-muted/40 rounded-xl px-3 py-2"
              >
                <dt className="text-muted-foreground truncate text-xs">
                  {item.label}
                </dt>
                <dd className="truncate text-base font-semibold tabular-nums">
                  {overviewQuery.isLoading ? "…" : item.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <AppChart
              type="area"
              data={chartData}
              categoryKey="label"
              series={["income"]}
              curved
              config={{
                income: {
                  label: t("dashboard.tenant.kpi_income"),
                  color: "var(--chart-1)",
                },
              }}
              valueFormatter={(v) => money(v)}
              tickValueFormatter={compact}
              categoryFormatter={(v) => datetime(v, "d MMM", locale)}
              loading={overviewQuery.isLoading}
              emptyTitle={t("reports.empty")}
              height={240}
              showLegend={false}
            />
          </div>
        </div>

        <div className="bg-card flex flex-col rounded-2xl border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">
              {t("dashboard.tenant.top_services")}
            </h2>
            <p className="text-muted-foreground text-xs">
              {t("dashboard.tenant.last_days", { days: CHART_DAYS })}
            </p>
          </div>
          {services.length === 0 ? (
            <p className="text-muted-foreground m-auto px-6 py-8 text-center text-sm">
              {t("reports.empty")}
            </p>
          ) : (
            <ul className="space-y-3 p-4">
              {services.map((service) => (
                <li key={service.key ?? service.name}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{service.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {service.count}× · {money(service.total)}
                    </span>
                  </div>
                  <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${(parseFinanceAmount(service.total) / serviceMax) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <MiniList
          title={t("dashboard.tenant.top_customers")}
          empty={t("reports.empty")}
          href={routes.tenant.customers.root(slug)}
          linkLabel={t("dashboard.tenant.all_customers")}
          items={customers.map((c) => ({
            key: c.customer_uuid,
            href: routes.tenant.customers.detail(slug, c.customer_uuid),
            primary: c.customer_name,
            secondary: t("dashboard.tenant.job_count", { count: c.job_count }),
            value: money(c.job_total),
          }))}
        />
        <MiniList
          title={t("dashboard.tenant.receivables")}
          empty={t("dashboard.tenant.receivables_empty")}
          href={routes.tenant.cari.root(slug)}
          linkLabel={t("dashboard.tenant.all_cari")}
          valueClass="text-amber-600 dark:text-amber-400"
          items={receivables.map((r) => ({
            key: r.account_uuid,
            href: routes.tenant.cari.detail(slug, r.account_uuid),
            primary: r.customer_name,
            secondary: r.customer_phone || "—",
            value: formatFinanceAmount(r.balance, r.currency, locale),
          }))}
        />
      </section>
    </>
  );
}

function MiniList({
  title,
  empty,
  href,
  linkLabel,
  items,
  valueClass,
}: {
  title: string;
  empty: string;
  href: string;
  linkLabel: string;
  valueClass?: string;
  items: Array<{
    key: string;
    href: string;
    primary: string;
    secondary: string;
    value: string;
  }>;
}) {
  return (
    <div className="bg-card flex flex-col rounded-2xl border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link
          href={href}
          className="text-primary text-xs font-medium hover:underline"
        >
          {linkLabel}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground m-auto px-6 py-8 text-center text-sm">
          {empty}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
              >
                <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
                  {item.primary.slice(0, 1).toLocaleUpperCase("tr-TR")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.primary}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {item.secondary}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    valueClass,
                  )}
                >
                  {item.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------- setup checklist */

function SetupChecklist({ slug, welcome }: { slug: string; welcome: boolean }) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useLocalStorage<boolean>(
    `otopoly.setup.dismissed.${slug}`,
    false,
  );
  const session = useWhatsAppSession();
  const services = useCatalogServices({ limit: 1, offset: 0 });
  const customers = useCustomers({ limit: 1, offset: 0 });
  const templates = useContractTemplates({ limit: 1, offset: 0 });
  const jobs = useJobs({ limit: 1, offset: 0 });

  const items: Array<{
    key: string;
    icon: LucideIcon;
    done: boolean;
    href: string;
  }> = [
    {
      key: "services",
      icon: Wrench,
      done: (services.data?.total ?? 0) > 0,
      href: routes.tenant.catalog.services.root(slug),
    },
    {
      key: "whatsapp",
      icon: MessageCircle,
      done: session.data?.status === "connected",
      href: routes.tenant.settings.messaging(slug),
    },
    {
      key: "customer",
      icon: UserPlus,
      done: (customers.data?.total ?? 0) > 0,
      href: routes.tenant.customers.root(slug),
    },
    {
      key: "job",
      icon: ClipboardList,
      done: (jobs.data?.total ?? 0) > 0,
      href: `${routes.tenant.operations.root(slug)}?new=1`,
    },
    {
      key: "contract",
      icon: FileSignature,
      done: (templates.data?.total ?? 0) > 0,
      href: routes.tenant.contracts.templates(slug),
    },
  ];
  const loading = [session, services, customers, templates, jobs].some(
    (q) => q.isLoading,
  );
  const doneCount = items.filter((i) => i.done).length;
  const complete = doneCount === items.length;

  if (loading || dismissed || (complete && !welcome)) return null;

  return (
    <section className="bg-card relative overflow-hidden rounded-2xl border">
      <div
        aria-hidden
        className="from-primary/10 absolute inset-0 bg-gradient-to-br via-transparent to-transparent"
      />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="bg-primary/15 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">
                {welcome
                  ? t("dashboard.tenant.setup.welcome_title")
                  : t("dashboard.tenant.setup.title")}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t("dashboard.tenant.setup.progress", {
                  done: doneCount,
                  total: items.length,
                })}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("dashboard.tenant.setup.dismiss")}
            onClick={() => setDismissed(true)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="bg-muted mt-4 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${(doneCount / items.length) * 100}%` }}
          />
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-full items-start gap-3 rounded-xl border p-3 transition-colors",
                  item.done
                    ? "bg-muted/40"
                    : "bg-background hover:border-primary/40",
                )}
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <span className="min-w-0">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-medium",
                      item.done && "text-muted-foreground line-through",
                    )}
                  >
                    <item.icon className="size-3.5 shrink-0" />
                    {t(`dashboard.tenant.setup.${item.key}.title`)}
                  </span>
                  {!item.done ? (
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {t(`dashboard.tenant.setup.${item.key}.hint`)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
