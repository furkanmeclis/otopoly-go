"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Columns3, List, Plus, Search, ShoppingBag, X } from "lucide-react";

import { DaySummaryBar } from "@/components/common/day-summary-bar";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { EntityActions, EntityPage, EntityToolbar } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { ResourceIOToolbar } from "@/features/io";
import { CreateJobDialog } from "@/features/jobs/components/create-job-dialog";
import type { JobQuickAction } from "@/features/jobs/components/job-board-card";
import { JobsBoard } from "@/features/jobs/components/jobs-board";
import { JobsTable } from "@/features/jobs/components/jobs-table";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import {
  useJobs,
  useJobsMeta,
  useJobsMutations,
  useJobsSummary,
} from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import {
  BOARD_STATUSES,
  localToday,
  matchesJob,
} from "@/features/jobs/lib/job-ui";
import type { Job } from "@/features/jobs/services/jobs.service";
import { QuickSaleDialog } from "@/features/sales/components/quick-sale-dialog";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type View = "board" | "list";
type ListFilter = "all" | (typeof BOARD_STATUSES)[number] | "closed";

const ALL_ASSIGNEES = "__all__";
const LIVE_REFRESH_MS = 30_000;

/** Ticks every 30s so elapsed times and "stale" flags stay current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function JobsPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantJobsAccess(slug);
  const { canWrite: canWriteSales } = useTenantSalesAccess(slug);
  const mutations = useJobsMutations();
  const now = useNow();

  const [date, setDate] = useState(() => localToday());
  const [view, setView] = useLocalStorage<View>("otopoly.jobs.view", "board");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState(ALL_ASSIGNEES);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [pendingUuid, setPendingUuid] = useState<string | null>(null);
  const searchParams = useSearchParams();
  // `?new=1` (dashboard / setup checklist) opens the create dialog once.
  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get("new") === "1",
  );
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      router.replace(routes.tenant.operations.root(slug), { scroll: false });
    }
  }, [router, searchParams, slug]);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);

  const isToday = date === localToday();
  // Load the whole day once; status/search/assignee filter client-side so
  // counts stay visible and filtering is instant.
  const listParams = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      sort: "-started_at",
      date_from: date || undefined,
      date_to: date || undefined,
    }),
    [date],
  );
  const listQuery = useJobs(listParams, {
    refetchInterval: isToday ? LIVE_REFRESH_MS : false,
  });
  const summaryQuery = useJobsSummary(date);
  const metaQuery = useJobsMeta();

  const allJobs = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const currency = allJobs[0]?.currency ?? "TRY";

  const assignees = useMemo(() => {
    const names = new Set<string>();
    for (const job of allJobs)
      if (job.assignee_name) names.add(job.assignee_name);
    return [...names].sort((a, b) => a.localeCompare(b, "tr"));
  }, [allJobs]);

  const filtered = useMemo(
    () =>
      allJobs.filter(
        (job) =>
          matchesJob(job, search) &&
          (assignee === ALL_ASSIGNEES || job.assignee_name === assignee) &&
          (!unpaidOnly || job.payment_status === "unpaid"),
      ),
    [allJobs, search, assignee, unpaidOnly],
  );

  const isClosed = (job: Job) =>
    job.status === "cancelled" || job.status === "voided";
  const openJobs = filtered.filter((job) => !isClosed(job));
  const closedJobs = filtered.filter(isClosed);
  const count = (status: ListFilter) =>
    status === "all"
      ? filtered.length
      : status === "closed"
        ? closedJobs.length
        : filtered.filter((job) => job.status === status).length;
  const listJobs =
    listFilter === "all"
      ? filtered
      : listFilter === "closed"
        ? closedJobs
        : filtered.filter((job) => job.status === listFilter);

  const hasFilters =
    Boolean(search) || assignee !== ALL_ASSIGNEES || unpaidOnly;
  const truncated = (listQuery.data?.total ?? 0) > allJobs.length;
  const summary = summaryQuery.data;

  const runAction = async (job: Job, action: JobQuickAction) => {
    setPendingUuid(job.uuid);
    try {
      if (action === "ready") await mutations.done.mutateAsync(job.uuid);
      else await mutations.deliver.mutateAsync(job.uuid);
    } catch {
      /* toast from mutation */
    } finally {
      setPendingUuid(null);
    }
  };

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("jobs.forbidden")}
      />
    );
  }

  const stats = [
    {
      label: t("jobs.board.cars"),
      value: String(summary?.job_count ?? allJobs.length),
    },
    {
      label: t("jobs.summary.paid_total"),
      value: formatFinanceAmount(summary?.paid_total, currency, locale),
      accent: true,
    },
    {
      label: t("jobs.summary.card_total"),
      value: formatFinanceAmount(summary?.card_total, currency, locale),
    },
    {
      label: t("jobs.summary.cari_total"),
      value: formatFinanceAmount(summary?.cari_total, currency, locale),
    },
    {
      label: t("jobs.summary.net_total"),
      value: formatFinanceAmount(summary?.net_total, currency, locale),
    },
  ];

  return (
    <EntityPage
      title={t("jobs.title")}
      description={t("jobs.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("jobs.title") },
      ]}
      actions={
        canWrite || canWriteSales ? (
          <EntityActions>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                {t("jobs.actions.create")}
              </Button>
            ) : null}
            {canWriteSales ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setQuickSaleOpen(true)}
              >
                <ShoppingBag className="size-4" />
                {t("sales.quick.title")}
              </Button>
            ) : null}
          </EntityActions>
        ) : null
      }
    >
      <DaySummaryBar
        date={date}
        onDateChange={setDate}
        stats={stats}
        loading={summaryQuery.isLoading}
        live
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("jobs.search_placeholder")}
            className="pr-8 pl-9"
            aria-label={t("jobs.search_placeholder")}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("common.clear")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {assignees.length > 0 ? (
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger
              className="w-[11rem]"
              aria-label={t("jobs.assignee")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ASSIGNEES}>
                {t("jobs.board.all_assignees")}
              </SelectItem>
              {assignees.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant={unpaidOnly ? "secondary" : "outline"}
          size="sm"
          aria-pressed={unpaidOnly}
          onClick={() => setUnpaidOnly((v) => !v)}
        >
          {t("jobs.board.unpaid_only")}
        </Button>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setAssignee(ALL_ASSIGNEES);
              setUnpaidOnly(false);
            }}
          >
            {t("jobs.board.clear_filters")}
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <div
            className="bg-muted flex rounded-lg p-0.5"
            role="radiogroup"
            aria-label={t("jobs.board.view")}
          >
            {(["board", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === v
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "board" ? (
                  <Columns3 className="size-3.5" />
                ) : (
                  <List className="size-3.5" />
                )}
                {t(`jobs.board.view_${v}`)}
              </button>
            ))}
          </div>
          <ResourceIOToolbar
            resource="tenant.jobs"
            query={{
              q: search || undefined,
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
      </div>

      {truncated ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t("jobs.board.truncated", {
            shown: allJobs.length,
            total: listQuery.data?.total ?? 0,
          })}
        </p>
      ) : null}

      {listQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("jobs.error_description")}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && allJobs.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <p className="font-medium">
            {t(isToday ? "jobs.board.empty_today" : "jobs.empty_title")}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {t("jobs.board.empty_hint")}
          </p>
          {canWrite ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("jobs.actions.create")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!listQuery.isLoading && allJobs.length > 0 && filtered.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          {t("jobs.empty_title")}
        </p>
      ) : null}

      {filtered.length > 0 && view === "board" ? (
        <>
          <JobsBoard
            slug={slug}
            jobs={openJobs}
            now={now}
            currency={currency}
            canWrite={canWrite}
            pendingUuid={pendingUuid}
            onAction={runAction}
          />
          {closedJobs.length > 0 ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="text-muted-foreground hover:text-foreground text-xs font-medium"
              >
                {t("jobs.board.closed_toggle", { count: closedJobs.length })}
              </button>
              {showClosed ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {closedJobs.map((job) => (
                    <Link
                      key={job.uuid}
                      href={routes.tenant.operations.detail(slug, job.uuid)}
                      className="bg-card hover:bg-muted flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
                    >
                      <PlateBadge plate={job.plate} size="sm" />
                      <span className="text-muted-foreground">
                        {t(`jobs.status.${job.status}`)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {filtered.length > 0 && view === "list" ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(["all", ...BOARD_STATUSES, "closed"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setListFilter(status)}
                aria-pressed={listFilter === status}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  listFilter === status
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {status === "all"
                  ? t("jobs.filter.all")
                  : status === "closed"
                    ? t("jobs.board.closed")
                    : t(`jobs.status.${status}`)}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {count(status)}
                </span>
              </button>
            ))}
          </div>
          <JobsTable
            slug={slug}
            jobs={listJobs}
            now={now}
            canWrite={canWrite}
            pendingUuid={pendingUuid}
            onAction={runAction}
          />
        </>
      ) : null}

      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={mutations.create.isPending}
        onSubmit={async (body) => {
          const created = await mutations.create.mutateAsync(body);
          setCreateOpen(false);
          router.push(routes.tenant.operations.detail(slug, created.uuid));
        }}
      />
      <QuickSaleDialog
        open={quickSaleOpen}
        onOpenChange={setQuickSaleOpen}
        onSuccess={(created) => {
          router.push(routes.tenant.sales.detail(slug, created.uuid));
        }}
      />
    </EntityPage>
  );
}
