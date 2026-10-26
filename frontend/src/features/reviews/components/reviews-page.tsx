"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ExternalLink,
  MessageSquareReply,
  Settings2,
  Smile,
  Star,
} from "lucide-react";

import { AppChart } from "@/components/charts/app-chart";
import { ErrorState } from "@/components/common/error-state";
import {
  EntityPage,
  EntityStatGrid,
  EntityStatTile,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import {
  TenantLiveResources,
  useTenantLiveList,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { FollowUpDialog } from "@/features/reviews/components/follow-up-dialog";
import { useReviewColumns } from "@/features/reviews/components/review-columns";
import {
  useReviews,
  useReviewsAccess,
  useReviewSummary,
} from "@/features/reviews/hooks/use-reviews";
import type {
  Review,
  ReviewFollowUpStatus,
  ReviewListParams,
  ReviewStatus,
  ReviewSummary,
} from "@/features/reviews/types";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useLocale } from "@/providers/locale-provider";

const PERIODS = [7, 30, 90, 365] as const;

export function ReviewsPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useReviewsAccess(slug);
  const [days, setDays] = useState<number>(30);
  const liveList = useTenantLiveList(TenantLiveResources.reviews);
  const listState = useServerListState({
    realtime: liveList,
    initialSort: "-created_at",
    initialPageSize: 20,
  });
  const listParams = useMemo<ReviewListParams>(() => {
    const score = columnSelectValue(listState.columnFilters, "score");
    return {
      ...listState.params,
      q:
        listState.params.q?.trim() ||
        columnTextValue(listState.columnFilters, "customer_name"),
      status: columnSelectValue(listState.columnFilters, "status") as
        ReviewStatus | undefined,
      follow_up: columnSelectValue(
        listState.columnFilters,
        "follow_up_status",
      ) as ReviewFollowUpStatus | undefined,
      channel: columnSelectValue(listState.columnFilters, "channel") as
        "sms" | "whatsapp" | undefined,
      score: score ? Number(score) : undefined,
    };
  }, [listState.columnFilters, listState.params]);
  const list = useReviews(listParams, canRead);
  const summary = useReviewSummary(days, canRead);
  useTenantLiveRefetch(TenantLiveResources.reviews, () => summary.refetch(), {
    enabled: canRead,
  });
  const [followUp, setFollowUp] = useState<Review | null>(null);
  const onFollowUp = useCallback((r: Review) => setFollowUp(r), []);
  const columns = useReviewColumns({ slug, canWrite, onFollowUp });

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("reviews.forbidden")}
      />
    );
  }
  const locked =
    isFeatureDisabledError(list.error) || isFeatureDisabledError(summary.error);
  const pageCount = Math.max(
    1,
    Math.ceil((list.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("reviews.title")}
      description={t("reviews.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("reviews.title") },
      ]}
      actions={
        canWrite ? (
          <Button asChild variant="outline" size="sm">
            <Link href={routes.tenant.reviews.settings(slug)}>
              <Settings2 className="size-4" />
              {t("reviews.settings.title")}
            </Link>
          </Button>
        ) : null
      }
    >
      {locked ? (
        <FeatureLocked slug={slug} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-end gap-2">
            <span className="text-muted-foreground text-sm">
              {t("reviews.summary.period")}
            </span>
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger className="w-36" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("reviews.summary.last_days", { count: d })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SummaryTiles
            data={summary.data}
            loading={summary.isLoading}
            onFollowUps={() =>
              listState.onColumnFiltersChange([
                { id: "follow_up_status", value: ["required"] },
              ])
            }
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionCard data={summary.data} />
            <TrendCard data={summary.data} className="lg:col-span-2" />
          </div>
          <EntityTable
            realtime={listState.realtimeFor(() => list.refetch())}
            columns={columns}
            data={list.data?.items ?? []}
            getRowId={(row) => row.uuid}
            onRowClick={(row) =>
              router.push(routes.tenant.reviews.detail(slug, row.uuid))
            }
            isLoading={list.isLoading}
            isError={list.isError}
            errorDescription={t("reviews.error")}
            onRetry={() => void list.refetch()}
            emptyTitle={t("reviews.empty")}
            emptyDescription={t("reviews.empty_hint")}
            pageCount={pageCount}
            state={listState.tableState}
            manual={{ filtering: true, sorting: true, pagination: true }}
            features={{
              persistKey: `tenant-reviews-${slug}`,
              columnFilters: true,
              rowSelection: false,
            }}
            toolbarExtra={
              <EntityToolbar
                onRefresh={() => void list.refetch()}
                refreshDisabled={list.isFetching}
              />
            }
          />
        </div>
      )}
      <FollowUpDialog
        review={followUp}
        open={Boolean(followUp)}
        onOpenChange={(open) => {
          if (!open) setFollowUp(null);
        }}
      />
    </EntityPage>
  );
}

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function SummaryTiles({
  data,
  loading,
  onFollowUps,
}: {
  data?: ReviewSummary;
  loading: boolean;
  onFollowUps: () => void;
}) {
  const { t } = useLocale();
  return (
    <EntityStatGrid className="lg:grid-cols-5">
      <EntityStatTile
        icon={Star}
        label={t("reviews.summary.average")}
        loading={loading}
        value={data?.answered_count ? data.average_score.toFixed(1) : "—"}
        hint={t("reviews.summary.answered_count", {
          count: data?.answered_count ?? 0,
        })}
        tone="warning"
      />
      <EntityStatTile
        icon={MessageSquareReply}
        label={t("reviews.summary.response_rate")}
        loading={loading}
        value={data ? pct(data.response_rate) : "—"}
        hint={t("reviews.summary.sent_count", { count: data?.sent_count ?? 0 })}
        progress={data ? data.response_rate * 100 : undefined}
      />
      <EntityStatTile
        icon={Smile}
        label={t("reviews.summary.nps")}
        loading={loading}
        value={data?.answered_count ? String(data.nps) : "—"}
        hint={t("reviews.summary.nps_hint", {
          promoters: data?.promoters ?? 0,
          detractors: data?.detractors ?? 0,
        })}
        tone={data && data.nps >= 30 ? "success" : "default"}
      />
      <EntityStatTile
        icon={ExternalLink}
        label={t("reviews.summary.google")}
        loading={loading}
        value={String(data?.google_redirects ?? 0)}
        hint={t("reviews.summary.google_hint")}
      />
      <button
        type="button"
        onClick={onFollowUps}
        className="text-left"
        aria-label={t("reviews.summary.follow_up")}
      >
        <EntityStatTile
          icon={AlertTriangle}
          label={t("reviews.summary.follow_up")}
          loading={loading}
          value={String(data?.follow_up_required ?? 0)}
          hint={t("reviews.summary.follow_up_hint")}
          tone={data?.follow_up_required ? "danger" : "default"}
          className="h-full"
        />
      </button>
    </EntityStatGrid>
  );
}

function DistributionCard({ data }: { data?: ReviewSummary }) {
  const { t } = useLocale();
  const rows = useMemo(
    () =>
      [...(data?.distribution ?? [])]
        .sort((a, b) => b.score - a.score)
        .map((d) => ({ label: `${d.score} ★`, count: d.count })),
    [data],
  );
  const any = rows.some((r) => r.count > 0);
  return (
    <AppChart
      type="bar-horizontal"
      title={t("reviews.summary.distribution")}
      data={any ? rows : []}
      config={{ count: { label: t("reviews.summary.count") } }}
      categoryKey="label"
      series={["count"]}
      showLegend={false}
      height={220}
      emptyTitle={t("reviews.summary.empty")}
    />
  );
}

function TrendCard({
  data,
  className,
}: {
  data?: ReviewSummary;
  className?: string;
}) {
  const { t, locale } = useLocale();
  const rows = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      day: data?.bucket === "month" ? undefined : "2-digit",
      month: "short",
    });
    return (data?.trend ?? []).map((p) => ({
      label: fmt.format(new Date(`${p.period_start}T12:00:00Z`)),
      sent: p.sent,
      answered: p.answered,
      average: p.average_score,
    }));
  }, [data, locale]);
  return (
    <AppChart
      type="composed"
      className={className}
      title={t("reviews.summary.trend")}
      description={t(
        data?.bucket === "month"
          ? "reviews.summary.trend_monthly"
          : "reviews.summary.trend_weekly",
      )}
      data={rows}
      config={{
        sent: { label: t("reviews.summary.sent"), color: "var(--chart-2)" },
        answered: {
          label: t("reviews.summary.answered"),
          color: "var(--chart-1)",
        },
        average: {
          label: t("reviews.summary.average"),
          color: "var(--chart-4)",
        },
      }}
      categoryKey="label"
      series={[
        { key: "sent", type: "bar" },
        { key: "answered", type: "bar" },
        { key: "average", type: "line", yAxisId: "right" },
      ]}
      height={220}
      emptyTitle={t("reviews.summary.empty")}
    />
  );
}
