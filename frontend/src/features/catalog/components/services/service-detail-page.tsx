"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Coins, Percent, Timer, Wrench } from "lucide-react";

import { BrandMark } from "@/components/common/brand-mark";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
  EntityStatGrid,
  EntityStatTile,
  EntityTable,
  EntityTabsList,
  EntityTrendChart,
  useDetailTab,
  type EntityStatTone,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { ServiceDialog } from "@/features/catalog/components/services/service-dialog";
import { ServiceProductsCard } from "@/features/catalog/components/services/service-products-card";
import {
  useServiceJobs,
  useServiceSummary,
} from "@/features/catalog/hooks/use-catalog-insights";
import { useCatalogServiceDetail } from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import { serviceSwatch } from "@/features/catalog/lib/service-colors";
import type { ServiceJob } from "@/features/catalog/services/catalog-insights.service";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import { paymentTone, statusTone } from "@/features/jobs/lib/job-ui";
import type {
  JobStatus,
  PaymentStatus,
} from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const TABS = ["overview", "jobs", "recipe"] as const;

function marginTone(percent: number): EntityStatTone {
  if (percent < 0) return "danger";
  if (percent < 15) return "warning";
  return "success";
}

export function ServiceDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { canWrite } = useTenantCatalogAccess(slug);
  const { canRead: canReadJobs } = useTenantJobsAccess(slug);
  const query = useCatalogServiceDetail(uuid);
  const summaryQuery = useServiceSummary(uuid);
  const jobsQuery = useServiceJobs(uuid, canReadJobs);
  const [tab, setTab] = useDetailTab(TABS);
  const service = query.data;
  const summary = summaryQuery.data;
  const usage = summary?.usage ?? null;
  const [editing, setEditing] = useState(false);

  const title = service?.name ?? t("catalog.detail.service_title");
  const currency = service?.currency ?? "TRY";
  const money = (v?: string | null) => formatFinanceAmount(v, currency, locale);
  const date = (v?: string | null) =>
    v ? datetime(v, "dd.MM.yyyy", locale) : "—";
  const nf = (v: number) =>
    v.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", {
      maximumFractionDigits: 1,
    });
  const moneyTick = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data]);

  const columns = useMemo<ColumnDef<ServiceJob>[]>(
    () => [
      createColumn<ServiceJob>({
        accessorKey: "plate",
        labelKey: "catalog.insights.service.columns.vehicle",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.operations.detail(slug, row.original.uuid)}
            className="inline-flex items-center gap-2 hover:underline"
          >
            <BrandMark
              name={row.original.brand_name}
              logoUrl={row.original.brand_logo_url}
            />
            <PlateBadge plate={row.original.plate} size="sm" />
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              {row.original.vehicle_label}
            </span>
          </Link>
        ),
      }),
      createColumn<ServiceJob>({
        accessorKey: "customer_name",
        labelKey: "catalog.insights.service.columns.customer",
        filterVariant: "text",
        cell: ({ row }) => (
          <Link
            href={routes.tenant.customers.detail(
              slug,
              row.original.customer_uuid,
            )}
            className="hover:underline"
          >
            {row.original.customer_name}
          </Link>
        ),
      }),
      createColumn<ServiceJob>({
        accessorKey: "status",
        labelKey: "catalog.insights.service.columns.status",
        filterVariant: "faceted",
        filterOptions: [
          "in_progress",
          "ready",
          "delivered",
          "cancelled",
          "voided",
        ].map((value) => ({
          value,
          label: value,
          labelKey: `jobs.status.${value}`,
        })),
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1.5">
            <StatusChip
              label={t(`jobs.status.${row.original.status}`)}
              tone={statusTone(row.original.status as JobStatus)}
            />
            <StatusChip
              label={t(`jobs.payment.${row.original.payment_status}`)}
              tone={paymentTone(row.original.payment_status as PaymentStatus)}
            />
          </span>
        ),
      }),
      createColumn<ServiceJob>({
        accessorKey: "started_at",
        labelKey: "catalog.insights.service.columns.started_at",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.started_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      }),
      createColumn<ServiceJob>({
        accessorKey: "qty",
        labelKey: "catalog.insights.service.columns.qty",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(row.original.qty, locale)}
          </span>
        ),
      }),
      createColumn<ServiceJob>({
        accessorKey: "line_total",
        labelKey: "catalog.insights.service.columns.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.line_total,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );

  const swatch = service ? serviceSwatch(service.color, service.name) : null;
  const recent = jobs.slice(0, 5);

  return (
    <EntityPage
      title={title}
      description={t("catalog.detail.service_description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        {
          label: t("catalog.services.title"),
          href: routes.tenant.catalog.services.root(slug),
        },
        { label: title },
      ]}
      actions={
        canWrite && service ? (
          <EntityActions>
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("catalog.detail.service_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {service ? (
        <div className="space-y-6">
          <EntityHeader
            leading={
              <span
                className={cn(
                  "grid size-14 shrink-0 place-items-center rounded-xl border",
                  swatch?.badge,
                )}
                aria-hidden
              >
                <Wrench className="size-6" />
              </span>
            }
            title={service.name}
            badges={
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  label={
                    service.is_active ? t("common.active") : t("common.passive")
                  }
                  tone={service.is_active ? "success" : "default"}
                />
                {service.category_uuid && service.category_name ? (
                  <Link
                    href={routes.tenant.catalog.categories.detail(
                      slug,
                      service.category_uuid,
                    )}
                    className="inline-flex"
                  >
                    <StatusChip label={service.category_name} />
                  </Link>
                ) : null}
              </div>
            }
            subtitle={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {service.code ? (
                  <span>
                    {t("catalog.services.code")}:{" "}
                    <span className="font-mono">{service.code}</span>
                  </span>
                ) : null}
                <span>
                  {t("catalog.services.duration")}:{" "}
                  {t("catalog.services.duration_value", {
                    minutes: service.duration_minutes,
                  })}
                </span>
              </span>
            }
            aside={
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {t("catalog.services.price")}
                </p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {money(service.price)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("catalog.services.vat_suffix", { rate: service.vat_rate })}
                </p>
              </div>
            }
          />

          <EntityStatGrid>
            {usage ? (
              <>
                <EntityStatTile
                  icon={Wrench}
                  label={t("catalog.insights.service.jobs")}
                  value={usage.job_count}
                  hint={t("catalog.insights.service.jobs_hint", {
                    count: usage.customer_count,
                  })}
                />
                <EntityStatTile
                  icon={Coins}
                  label={t("catalog.insights.service.revenue")}
                  value={money(usage.revenue)}
                  hint={t("catalog.insights.service.revenue_hint", {
                    avg: money(usage.avg_unit_price),
                  })}
                />
                <EntityStatTile
                  icon={Timer}
                  label={t("catalog.insights.service.avg_duration")}
                  value={
                    usage.avg_job_minutes > 0
                      ? t("catalog.insights.service.avg_duration_value", {
                          minutes: nf(usage.avg_job_minutes),
                        })
                      : "—"
                  }
                  tone={
                    usage.avg_job_minutes > 0 &&
                    usage.avg_job_minutes > service.duration_minutes * 1.25
                      ? "warning"
                      : "default"
                  }
                  hint={t("catalog.insights.service.avg_duration_hint", {
                    minutes: service.duration_minutes,
                  })}
                />
              </>
            ) : (
              <EntityStatTile
                icon={CalendarClock}
                label={t("catalog.insights.service.last_used")}
                loading={summaryQuery.isLoading}
                value="—"
                hint={t("catalog.insights.service.no_permission")}
                className="col-span-2 lg:col-span-3"
              />
            )}
            <EntityStatTile
              icon={Percent}
              label={t("catalog.insights.service.margin")}
              loading={summaryQuery.isLoading}
              value={money(summary?.pricing.unit_margin)}
              tone={marginTone(summary?.pricing.margin_percent ?? 0)}
              hint={t("catalog.insights.service.margin_hint", {
                cost: money(summary?.pricing.recipe_cost),
                percent: nf(summary?.pricing.margin_percent ?? 0),
              })}
            />
          </EntityStatGrid>

          <Tabs value={tab} onValueChange={setTab}>
            <EntityTabsList
              items={[
                {
                  value: "overview",
                  label: t("catalog.insights.tabs.overview"),
                },
                {
                  value: "jobs",
                  label: t("catalog.insights.tabs.jobs"),
                  badge: usage?.job_count ?? null,
                  hidden: !canReadJobs,
                },
                {
                  value: "recipe",
                  label: t("catalog.insights.tabs.recipe"),
                  badge: summary?.pricing.recipe_item_count ?? null,
                },
              ]}
            />

            <TabsContent value="overview" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  {usage ? (
                    <EntityTrendChart
                      title={t("catalog.insights.service.usage_trend")}
                      description={t(
                        "catalog.insights.service.usage_trend_hint",
                      )}
                      points={usage.monthly}
                      series={[
                        {
                          key: "amount",
                          label: t("catalog.insights.revenue"),
                        },
                      ]}
                      valueFormatter={(v) => money(String(v))}
                      tickValueFormatter={moneyTick}
                      emptyTitle={t("catalog.insights.service.no_jobs")}
                    />
                  ) : null}
                  {canReadJobs ? (
                    <EntitySectionCard
                      title={t("catalog.insights.service.recent_jobs")}
                      badge={usage?.job_count || undefined}
                      action={
                        jobs.length > recent.length ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto px-0"
                            onClick={() => setTab("jobs")}
                          >
                            {t("catalog.insights.view_all")}
                          </Button>
                        ) : null
                      }
                    >
                      {jobsQuery.isLoading ? (
                        <p className="text-muted-foreground text-sm">
                          {t("common.loading")}
                        </p>
                      ) : recent.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t("catalog.insights.service.no_jobs")}
                        </p>
                      ) : (
                        <ul className="divide-border divide-y text-sm">
                          {recent.map((job) => (
                            <li key={job.uuid}>
                              <Link
                                href={routes.tenant.operations.detail(
                                  slug,
                                  job.uuid,
                                )}
                                className="hover:bg-muted/40 -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <BrandMark
                                    name={job.brand_name}
                                    logoUrl={job.brand_logo_url}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                      {job.plate} · {job.customer_name}
                                    </span>
                                    <span className="text-muted-foreground block text-xs tabular-nums">
                                      {datetime(
                                        job.started_at,
                                        "dd.MM.yyyy HH:mm",
                                        locale,
                                      )}{" "}
                                      · {t(`jobs.status.${job.status}`)}
                                    </span>
                                  </span>
                                </span>
                                <span className="shrink-0 font-medium tabular-nums">
                                  {formatFinanceAmount(
                                    job.line_total,
                                    job.currency,
                                    locale,
                                  )}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </EntitySectionCard>
                  ) : null}
                </div>
                <div className="space-y-6 lg:col-span-2">
                  <EntitySectionCard title={t("catalog.detail.service_info")}>
                    <EntityDetail
                      sections={[
                        {
                          id: "info",
                          fields: [
                            {
                              key: "price",
                              label: t("catalog.services.price"),
                              value: money(service.price),
                            },
                            {
                              key: "vat",
                              label: t("catalog.services.vat_rate"),
                              value: t("catalog.services.vat_suffix", {
                                rate: service.vat_rate,
                              }),
                            },
                            {
                              key: "last_used",
                              label: t("catalog.insights.service.last_used"),
                              value: usage ? date(usage.last_used_at) : "—",
                            },
                            {
                              key: "first_used",
                              label: t("catalog.detail.created_at"),
                              value: datetime(
                                service.created_at,
                                "dd.MM.yyyy HH:mm",
                                locale,
                              ),
                            },
                            {
                              key: "updated",
                              label: t("catalog.detail.updated_at"),
                              value: datetime(
                                service.updated_at,
                                "dd.MM.yyyy HH:mm",
                                locale,
                              ),
                            },
                          ],
                        },
                      ]}
                    />
                  </EntitySectionCard>
                  <EntitySectionCard
                    title={t("catalog.services.description_field")}
                  >
                    <p
                      className={cn(
                        "text-sm whitespace-pre-line",
                        !service.description && "text-muted-foreground",
                      )}
                    >
                      {service.description ||
                        t("catalog.insights.no_description")}
                    </p>
                  </EntitySectionCard>
                </div>
              </div>
            </TabsContent>

            {canReadJobs ? (
              <TabsContent value="jobs" className="mt-4">
                <EntitySectionCard
                  title={t("catalog.insights.tabs.jobs")}
                  badge={jobs.length}
                >
                  <EntityTable
                    columns={columns}
                    data={jobs}
                    getRowId={(row) => row.uuid}
                    isLoading={jobsQuery.isLoading}
                    isError={jobsQuery.isError}
                    onRetry={() => void jobsQuery.refetch()}
                    emptyTitle={t("catalog.insights.service.no_jobs")}
                    emptyDescription={t(
                      "catalog.insights.service.no_jobs_hint",
                    )}
                    features={{
                      rowSelection: false,
                      columnOrdering: false,
                      columnPinning: false,
                      columnResizing: false,
                      viewMode: false,
                    }}
                  />
                </EntitySectionCard>
              </TabsContent>
            ) : (
              <TabsContent value="jobs" className="mt-4">
                <EmptyState
                  title={t("common.error_forbidden")}
                  description={t("catalog.insights.service.no_permission")}
                />
              </TabsContent>
            )}

            <TabsContent value="recipe" className="mt-4">
              <ServiceProductsCard service={service} canWrite={canWrite} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      <ServiceDialog
        open={editing}
        onOpenChange={setEditing}
        service={service}
      />
    </EntityPage>
  );
}
