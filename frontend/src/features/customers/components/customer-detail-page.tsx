"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Car,
  Coins,
  Mail,
  Pencil,
  Phone,
  Trash2,
  Wallet,
  Wrench,
} from "lucide-react";
import { useWatch } from "react-hook-form";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { BrandMark } from "@/components/common/brand-mark";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityAvatar,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntityRowActions,
  EntitySectionCard,
  EntityStatGrid,
  EntityStatTile,
  EntityTable,
  EntityTabsList,
  EntityTrendChart,
  useDetailTab,
  type EntityRowAction,
} from "@/components/entity";
import {
  AppCombobox,
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
} from "@/components/forms";
import { createColumn } from "@/components/tables";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { useCariEntries } from "@/features/cari/hooks/use-cari";
import { useTenantCariAccess } from "@/features/cari/hooks/use-tenant-cari-access";
import { CustomerActivityTab } from "@/features/customers/components/customer-activity-tab";
import {
  CustomerJobsTable,
  CustomerLeadsTable,
  CustomerQuotesTable,
  CustomerSalesTable,
} from "@/features/customers/components/customer-related-tables";
import { useTenantCustomersAccess } from "@/features/customers/hooks/use-tenant-customers-access";
import {
  useCustomer,
  useCustomerMutations,
  useCustomerSummary,
} from "@/features/customers/hooks/use-customers";
import {
  catalogPickerOptions,
  customersService,
  type Customer,
  type CustomerVehicle,
} from "@/features/customers/services/customers.service";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import { useLeadsAccess } from "@/features/leads/hooks/use-leads";
import { useQuotesAccess } from "@/features/quotes/hooks/use-quotes";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";

const CUSTOMER_TABS = [
  "overview",
  "vehicles",
  "jobs",
  "sales",
  "quotes",
  "leads",
  "cari",
  "activity",
] as const;

type VehicleRow = CustomerVehicle & {
  job_count?: number;
  spend?: string;
  last_visit_at?: string | null;
};

export function CustomerDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canRead, canWrite } = useTenantCustomersAccess(slug);
  const { canRead: canReadCari } = useTenantCariAccess(slug);
  const { canRead: canReadJobs } = useTenantJobsAccess(slug);
  const { canRead: canReadSales } = useTenantSalesAccess(slug);
  const { canRead: canReadQuotes } = useQuotesAccess();
  const { canRead: canReadLeads } = useLeadsAccess();
  const query = useCustomer(uuid);
  const summaryQuery = useCustomerSummary(uuid);
  const refetchSummary = summaryQuery.refetch;
  useTenantLiveRefetch(TenantLiveResources.customers, query.refetch, { uuid });
  useTenantLiveRefetch(TenantLiveResources.customers, refetchSummary, { uuid });
  useTenantLiveRefetch(TenantLiveResources.jobs, refetchSummary);
  useTenantLiveRefetch(TenantLiveResources.sales, refetchSummary);
  const [tab, setTab] = useDetailTab(CUSTOMER_TABS);
  const mutations = useCustomerMutations();
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const customer = query.data;
  const summary = summaryQuery.data;
  const title = customer?.name ?? t("customers.title");
  const cariAccountUuid = customer?.cari_account_uuid ?? null;
  const recentEntriesQuery = useCariEntries(cariAccountUuid ?? "", {
    limit: 5,
    offset: 0,
  });
  const money = (v?: string | null) => formatFinanceAmount(v, "TRY", locale);
  const date = (v?: string | null) =>
    v ? datetime(v, "dd.MM.yyyy", locale) : "—";
  const moneyTick = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const vehicles = useMemo<VehicleRow[]>(() => {
    const stats = new Map(
      (summary?.vehicles ?? []).map((v) => [v.vehicle_uuid, v]),
    );
    return (customer?.vehicles ?? []).map((v) => {
      const s = stats.get(v.uuid);
      return s
        ? {
            ...v,
            job_count: s.job_count,
            spend: s.spend,
            last_visit_at: s.last_visit_at,
          }
        : v;
    });
  }, [customer?.vehicles, summary?.vehicles]);

  const columns = useMemo<ColumnDef<VehicleRow>[]>(() => {
    const base: ColumnDef<VehicleRow>[] = [
      createColumn<VehicleRow>({
        accessorKey: "plate",
        labelKey: "customers.detail.plate",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => <PlateBadge plate={row.original.plate} size="sm" />,
      }),
      createColumn<VehicleRow>({
        id: "vehicle",
        labelKey: "customers.detail.brand_model",
        accessorFn: (row) => `${row.brand_name} ${row.model_name}`,
        filterVariant: "text",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <BrandMark
              name={row.original.brand_name}
              logoUrl={row.original.logo_url}
              size="md"
            />
            <span>
              {row.original.brand_name} {row.original.model_name}
            </span>
          </div>
        ),
      }),
      createColumn<VehicleRow>({
        accessorKey: "year",
        labelKey: "customers.detail.year",
        accessorFn: (row) => String(row.year),
        filterVariant: "text",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.year}</span>
        ),
      }),
    ];

    if (canReadJobs) {
      base.push(
        createColumn<VehicleRow>({
          accessorKey: "job_count",
          labelKey: "customers.insights.vehicle_jobs",
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.job_count ?? 0}</span>
          ),
        }),
        createColumn<VehicleRow>({
          accessorKey: "spend",
          labelKey: "customers.insights.vehicle_spend",
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatFinanceAmount(row.original.spend ?? "0", "TRY", locale)}
            </span>
          ),
        }),
        createColumn<VehicleRow>({
          accessorKey: "last_visit_at",
          labelKey: "customers.insights.last_visit",
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.last_visit_at
                ? datetime(row.original.last_visit_at, "dd.MM.yyyy", locale)
                : "—"}
            </span>
          ),
        }),
      );
    }

    if (!canWrite) return base;

    base.push({
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const actions: EntityRowAction[] = [
          {
            id: "delete",
            label: t("common.delete"),
            icon: Trash2,
            variant: "destructive",
            onSelect: async () => {
              const confirmed = await confirmDelete({
                title: t("common.delete"),
                description: t("customers.detail.remove_vehicle_confirm"),
              });
              if (!confirmed) return;
              await mutations.removeVehicle.mutateAsync(row.original.uuid);
            },
          },
        ];
        return <EntityRowActions actions={actions} />;
      },
    });

    return base;
  }, [
    canReadJobs,
    canWrite,
    confirmDelete,
    locale,
    mutations.removeVehicle,
    t,
  ]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("customers.forbidden")}
      />
    );
  }

  const jobs = summary?.jobs ?? null;
  const sales = summary?.sales ?? null;
  const balance = customer?.cari_balance
    ? parseFinanceAmount(customer.cari_balance)
    : 0;

  return (
    <EntityPage
      title={title}
      description={t("customers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("customers.title"),
          href: routes.tenant.customers.root(slug),
        },
        { label: title },
      ]}
      actions={
        customer && canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setVehicleOpen(true)}
            >
              <Car className="size-4" />
              {t("customers.detail.add_vehicle")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                const confirmed = await confirmDelete({
                  title: t("customers.detail.delete"),
                  description: t("customers.detail.delete_confirm"),
                });
                if (!confirmed) return;
                await mutations.remove.mutateAsync(uuid);
                router.push(routes.tenant.customers.root(slug));
              }}
            >
              <Trash2 className="size-4" />
              {t("customers.detail.delete")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("customers.error_description")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {customer ? (
        <div className="space-y-6">
          <EntityHeader
            leading={
              <EntityAvatar
                name={customer.name}
                icon={customer.kind === "company" ? Building2 : undefined}
              />
            }
            title={customer.name}
            subtitle={
              customer.phone || customer.email ? (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {customer.phone ? (
                    <a
                      href={`tel:${customer.phone}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Phone className="size-3.5" aria-hidden />
                      {customer.phone}
                    </a>
                  ) : null}
                  {customer.email ? (
                    <a
                      href={`mailto:${customer.email}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Mail className="size-3.5" aria-hidden />
                      {customer.email}
                    </a>
                  ) : null}
                </span>
              ) : undefined
            }
            badges={
              <>
                <StatusChip
                  label={
                    customer.is_active
                      ? t("common.active")
                      : t("common.passive")
                  }
                  tone={customer.is_active ? "success" : "default"}
                />
                <StatusChip
                  label={t(`customers.kind.${customer.kind}`)}
                  tone="default"
                />
              </>
            }
            aside={
              summary && (jobs || sales) ? (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">
                    {t("customers.insights.total_spend")}
                  </p>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {money(summary.total_spend)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("customers.insights.last_visit_value", {
                      date: date(summary.last_visit_at),
                    })}
                  </p>
                </div>
              ) : null
            }
          />

          <EntityStatGrid>
            <EntityStatTile
              icon={Car}
              label={t("customers.insights.vehicles")}
              value={customer.vehicles.length}
              hint={
                customer.vehicles[0]
                  ? `${customer.vehicles[0].plate} · ${customer.vehicles[0].brand_name}`
                  : t("customers.detail.no_vehicles")
              }
            />
            {jobs ? (
              <EntityStatTile
                icon={Wrench}
                label={t("customers.insights.jobs")}
                value={jobs.job_count}
                tone={jobs.open_job_count > 0 ? "warning" : "default"}
                hint={t("customers.insights.jobs_hint", {
                  open: jobs.open_job_count,
                  unpaid: jobs.unpaid_job_count,
                })}
              />
            ) : null}
            {jobs || sales ? (
              <EntityStatTile
                icon={Coins}
                label={t("customers.insights.total_spend")}
                loading={summaryQuery.isLoading}
                value={money(summary?.total_spend)}
                hint={t("customers.insights.spend_split", {
                  jobs: money(jobs?.spend ?? "0"),
                  sales: money(sales?.spend ?? "0"),
                })}
              />
            ) : null}
            {cariAccountUuid && customer.cari_balance != null ? (
              <EntityStatTile
                icon={Wallet}
                label={t("customers.insights.balance")}
                value={money(customer.cari_balance)}
                tone={balance > 0 ? "warning" : "success"}
                hint={
                  balance > 0
                    ? t("customers.insights.balance_due")
                    : t("customers.insights.balance_clear")
                }
                href={
                  canReadCari
                    ? routes.tenant.cari.detail(slug, cariAccountUuid)
                    : undefined
                }
              />
            ) : jobs ? (
              <EntityStatTile
                icon={CalendarClock}
                label={t("customers.insights.last_visit")}
                value={date(jobs.last_visit_at)}
                hint={t("customers.insights.first_visit", {
                  date: date(jobs.first_visit_at),
                })}
              />
            ) : null}
          </EntityStatGrid>

          {jobs?.unpaid_amount && parseFinanceAmount(jobs.unpaid_amount) > 0 ? (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>{t("customers.insights.unpaid_title")}</AlertTitle>
              <AlertDescription>
                {t("customers.insights.unpaid_body", {
                  count: jobs.unpaid_job_count,
                  amount: money(jobs.unpaid_amount),
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <EntityTabsList
              items={[
                {
                  value: "overview",
                  label: t("customers.insights.tabs.overview"),
                },
                {
                  value: "vehicles",
                  label: t("customers.insights.tabs.vehicles"),
                  badge: customer.vehicles.length,
                },
                {
                  value: "jobs",
                  label: t("customers.insights.tabs.jobs"),
                  badge: jobs?.job_count ?? null,
                  hidden: !canReadJobs,
                },
                {
                  value: "sales",
                  label: t("customers.insights.tabs.sales"),
                  badge: sales?.sale_count ?? null,
                  hidden: !canReadSales,
                },
                {
                  value: "quotes",
                  label: t("customers.insights.tabs.quotes"),
                  badge: summary?.quotes?.quote_count ?? null,
                  hidden: !canReadQuotes,
                },
                {
                  value: "leads",
                  label: t("customers.insights.tabs.leads"),
                  badge: summary?.leads?.lead_count ?? null,
                  hidden: !canReadLeads,
                },
                {
                  value: "cari",
                  label: t("customers.insights.tabs.cari"),
                  hidden: !(cariAccountUuid && canReadCari),
                },
                {
                  value: "activity",
                  label: t("customers.insights.tabs.activity"),
                },
              ]}
            />

            <TabsContent value="overview" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  {jobs || sales ? (
                    <EntityTrendChart
                      title={t("customers.insights.spend_trend")}
                      description={t("customers.insights.spend_trend_hint")}
                      points={summary?.monthly}
                      series={[
                        {
                          key: "amount",
                          label: t("customers.insights.tabs.jobs"),
                        },
                        {
                          key: "amount_secondary",
                          label: t("customers.insights.tabs.sales"),
                        },
                      ]}
                      stacked
                      valueFormatter={(v) => money(String(v))}
                      tickValueFormatter={moneyTick}
                      emptyTitle={t("customers.insights.no_spend")}
                    />
                  ) : null}
                  {summary?.top_services?.length ? (
                    <EntitySectionCard
                      title={t("customers.insights.top_services")}
                    >
                      <ul className="divide-border divide-y text-sm">
                        {summary.top_services.map((s) => (
                          <li
                            key={`${s.service_uuid ?? ""}-${s.name}`}
                            className="flex items-center justify-between gap-4 py-2"
                          >
                            <div className="min-w-0">
                              {s.service_uuid ? (
                                <Link
                                  href={routes.tenant.catalog.services.detail(
                                    slug,
                                    s.service_uuid,
                                  )}
                                  className="font-medium hover:underline"
                                >
                                  {s.name}
                                </Link>
                              ) : (
                                <p className="font-medium">{s.name}</p>
                              )}
                              <p className="text-muted-foreground text-xs">
                                {t("customers.insights.top_service_hint", {
                                  count: s.job_count,
                                  date: date(s.last_used_at),
                                })}
                              </p>
                            </div>
                            <span className="shrink-0 tabular-nums">
                              {money(s.revenue)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </EntitySectionCard>
                  ) : null}
                </div>
                <div className="space-y-6 lg:col-span-2">
                  <EntitySectionCard title={t("customers.detail.info")}>
                    <EntityDetail
                      sections={[
                        {
                          id: "contact",
                          fields: [
                            {
                              key: "phone",
                              label: t("customers.fields.phone"),
                              value: customer.phone || "—",
                            },
                            {
                              key: "email",
                              label: t("customers.fields.email"),
                              value: customer.email || "—",
                            },
                            {
                              key: "kind",
                              label: t("customers.fields.kind"),
                              value: t(`customers.kind.${customer.kind}`),
                            },
                            ...(customer.kind === "company"
                              ? [
                                  {
                                    key: "tax_id",
                                    label: t("customers.fields.tax_id"),
                                    value: customer.tax_id || "—",
                                  },
                                  {
                                    key: "tax_office",
                                    label: t("customers.fields.tax_office"),
                                    value: customer.tax_office || "—",
                                  },
                                ]
                              : []),
                            {
                              key: "first_visit",
                              label: t("customers.insights.first_visit_label"),
                              value: date(jobs?.first_visit_at),
                            },
                            {
                              key: "created",
                              label: t("customers.created_at"),
                              value: datetime(
                                customer.created_at,
                                "dd.MM.yyyy HH:mm",
                                locale,
                              ),
                            },
                          ],
                        },
                      ]}
                    />
                  </EntitySectionCard>
                  {summary?.quotes || summary?.leads ? (
                    <EntitySectionCard title={t("customers.insights.pipeline")}>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        {summary.quotes ? (
                          <div className="space-y-1">
                            <dt className="text-muted-foreground text-xs">
                              {t("customers.insights.tabs.quotes")}
                            </dt>
                            <dd className="font-medium tabular-nums">
                              {t("customers.insights.quotes_value", {
                                open: summary.quotes.open_quote_count,
                                accepted: summary.quotes.accepted_quote_count,
                              })}
                            </dd>
                          </div>
                        ) : null}
                        {summary.leads ? (
                          <div className="space-y-1">
                            <dt className="text-muted-foreground text-xs">
                              {t("customers.insights.tabs.leads")}
                            </dt>
                            <dd className="font-medium tabular-nums">
                              {t("customers.insights.leads_value", {
                                open: summary.leads.open_lead_count,
                                total: summary.leads.lead_count,
                              })}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </EntitySectionCard>
                  ) : null}
                  <EntitySectionCard title={t("customers.fields.notes")}>
                    <p
                      className={cn(
                        "text-sm whitespace-pre-line",
                        !customer.notes && "text-muted-foreground",
                      )}
                    >
                      {customer.notes || t("customers.insights.no_notes")}
                    </p>
                  </EntitySectionCard>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="vehicles" className="mt-4">
              <EntitySectionCard
                title={t("customers.detail.vehicles")}
                badge={vehicles.length}
              >
                <EntityTable
                  columns={columns}
                  data={vehicles}
                  getRowId={(row) => row.uuid}
                  emptyTitle={t("customers.detail.no_vehicles")}
                  emptyDescription={t(
                    "customers.detail.vehicles_empty_description",
                  )}
                  features={{
                    persistKey: `tenant-customer-vehicles-${uuid}`,
                    columnFilters: true,
                  }}
                />
              </EntitySectionCard>
            </TabsContent>

            {canReadJobs ? (
              <TabsContent value="jobs" className="mt-4">
                <EntitySectionCard
                  title={t("customers.insights.tabs.jobs")}
                  badge={jobs?.job_count}
                >
                  <CustomerJobsTable slug={slug} customerUuid={uuid} />
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            {canReadSales ? (
              <TabsContent value="sales" className="mt-4">
                <EntitySectionCard
                  title={t("customers.insights.tabs.sales")}
                  badge={sales?.sale_count}
                >
                  <CustomerSalesTable
                    slug={slug}
                    sales={summary?.recent_sales ?? []}
                  />
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            {canReadQuotes ? (
              <TabsContent value="quotes" className="mt-4">
                <EntitySectionCard
                  title={t("customers.insights.tabs.quotes")}
                  badge={summary?.quotes?.quote_count}
                >
                  {tab === "quotes" ? (
                    <CustomerQuotesTable slug={slug} customerUuid={uuid} />
                  ) : null}
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            {canReadLeads ? (
              <TabsContent value="leads" className="mt-4">
                <EntitySectionCard
                  title={t("customers.insights.tabs.leads")}
                  badge={summary?.leads?.lead_count}
                >
                  {tab === "leads" ? (
                    <CustomerLeadsTable slug={slug} customerUuid={uuid} />
                  ) : null}
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            {cariAccountUuid && canReadCari ? (
              <TabsContent value="cari" className="mt-4">
                <EntitySectionCard
                  title={t("customers.detail.recent_cari_entries")}
                  badge={recentEntriesQuery.data?.total}
                  action={
                    <Link
                      href={routes.tenant.cari.detail(slug, cariAccountUuid)}
                      className="text-primary text-sm underline-offset-4 hover:underline"
                    >
                      {t("customers.detail.view_cari")}
                    </Link>
                  }
                >
                  {recentEntriesQuery.isLoading ? (
                    <p className="text-muted-foreground text-sm">
                      {t("common.loading")}
                    </p>
                  ) : (
                    <ul className="divide-border divide-y text-sm">
                      {(recentEntriesQuery.data?.items ?? []).map((entry) => (
                        <li
                          key={entry.uuid}
                          className="flex items-center justify-between gap-4 py-2"
                        >
                          <div className="min-w-0">
                            <p className="font-medium tabular-nums">
                              {entry.entry_date} ·{" "}
                              {t(`cari.entry_type.${entry.type}`)}
                            </p>
                            <p className="text-muted-foreground truncate">
                              {entry.description || "—"}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums">
                            {formatFinanceAmount(entry.amount, "TRY", locale)}
                          </span>
                        </li>
                      ))}
                      {!recentEntriesQuery.data?.items?.length ? (
                        <li className="text-muted-foreground py-2">
                          {t("customers.detail.no_cari_entries")}
                        </li>
                      ) : null}
                    </ul>
                  )}
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            <TabsContent value="activity" className="mt-4">
              <EntitySectionCard title={t("customers.activity.title")}>
                <CustomerActivityTab
                  slug={slug}
                  customerUuid={uuid}
                  cariAccountUuid={canReadCari ? cariAccountUuid : null}
                  active={tab === "activity"}
                />
              </EntitySectionCard>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      <CustomerEditDialog
        customer={editing ? customer : null}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      />
      <VehicleDialog
        open={vehicleOpen}
        pending={mutations.addVehicle.isPending}
        onOpenChange={setVehicleOpen}
        onSubmit={async (body) => {
          await mutations.addVehicle.mutateAsync({ customerUuid: uuid, body });
          setVehicleOpen(false);
        }}
      />
    </EntityPage>
  );
}

function CustomerEditDialog({
  customer,
  onOpenChange,
}: {
  customer: Customer | null | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { update } = useCustomerMutations();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        phone: z.string().optional(),
        email: z.string().optional(),
        kind: z.enum(["individual", "company"]),
        notes: z.string().optional(),
        tax_id: z.string().optional(),
        tax_office: z.string().optional(),
        is_active: z.boolean(),
      }),
    [t],
  );

  return (
    <Dialog open={Boolean(customer)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("customers.dialog.edit_title")}</DialogTitle>
          <DialogDescription>
            {t("customers.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {customer ? (
          <AppForm
            key={customer.uuid}
            schema={schema}
            defaultValues={{
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              kind: customer.kind,
              notes: customer.notes,
              tax_id: customer.tax_id ?? "",
              tax_office: customer.tax_office ?? "",
              is_active: customer.is_active,
            }}
            onSubmit={async (values) => {
              await update.mutateAsync({
                uuid: customer.uuid,
                body: {
                  ...values,
                  tax_id: values.kind === "company" ? values.tax_id : "",
                  tax_office:
                    values.kind === "company" ? values.tax_office : "",
                },
              });
              onOpenChange(false);
            }}
          >
            <CustomerFields />
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </AppForm>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerFields() {
  const { t } = useLocale();
  const kind = useWatch({ name: "kind" }) as string | undefined;
  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      <AppInput
        name="name"
        label={t("customers.fields.name")}
        placeholder={t("customers.fields.name_placeholder")}
        required
      />
      <AppInput
        name="phone"
        label={t("customers.fields.phone")}
        placeholder={t("customers.fields.phone_placeholder")}
      />
      <AppInput name="email" label={t("customers.fields.email")} />
      <AppSelect
        name="kind"
        label={t("customers.fields.kind")}
        options={[
          { value: "individual", label: t("customers.kind.individual") },
          { value: "company", label: t("customers.kind.company") },
        ]}
      />
      {kind === "company" ? (
        <>
          <AppInput
            name="tax_id"
            label={t("customers.fields.tax_id")}
            placeholder={t("customers.fields.tax_id_placeholder")}
          />
          <AppInput
            name="tax_office"
            label={t("customers.fields.tax_office")}
            placeholder={t("customers.fields.tax_office_placeholder")}
          />
        </>
      ) : null}
      <AppTextarea
        name="notes"
        label={t("customers.fields.notes")}
        className="sm:col-span-2"
      />
      <AppSwitch
        name="is_active"
        label={t("customers.fields.active")}
        className="sm:col-span-2"
      />
    </FieldGroup>
  );
}

export function VehicleDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: {
    plate: string;
    model_uuid: string;
    year: number;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const schema = useMemo(
    () =>
      z.object({
        plate: z.string().min(1, t("form.required")),
        catalog: z.string().min(1, t("form.required")),
      }),
    [t],
  );

  const loadOptions = useCallback(async (query: string) => {
    const result = await customersService.searchCatalog(query.trim());
    return catalogPickerOptions(result.items ?? []);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("customers.dialog.vehicle_title")}</DialogTitle>
          <DialogDescription>
            {t("customers.dialog.vehicle_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "vehicle-open" : "vehicle-closed"}
          schema={schema}
          defaultValues={{ plate: "", catalog: "" }}
          onSubmit={async (values) => {
            const [modelUuid, yearText] = values.catalog.split(":");
            await onSubmit({
              plate: values.plate,
              model_uuid: modelUuid,
              year: Number(yearText),
            });
          }}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="plate"
              label={t("customers.detail.plate")}
              placeholder={t("customers.detail.plate_placeholder")}
              required
            />
            <AppCombobox
              name="catalog"
              label={t("customers.detail.catalog")}
              loadOptions={loadOptions}
              placeholder={t("customers.detail.search_placeholder")}
              searchPlaceholder={t("customers.detail.search_placeholder")}
              emptyText={t("customers.detail.search_empty")}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
