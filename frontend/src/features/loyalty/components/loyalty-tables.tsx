"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarClock,
  Edit,
  Eye,
  PackagePlus,
  Trash2,
  UserPlus,
} from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import {
  EntityRowActions,
  EntityTable,
  EntityToolbar,
  useServerListState,
  type EntityRowAction,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Progress } from "@/components/ui/progress";
import { routes } from "@/config/routes";
import { columnSelectValue } from "@/features/catalog/lib/column-filters";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { CampaignDialog } from "@/features/loyalty/components/campaign-dialog";
import { PackageDialog } from "@/features/loyalty/components/package-dialog";
import { PlanDialog } from "@/features/loyalty/components/plan-dialog";
import { SellPackageDialog } from "@/features/loyalty/components/sell-package-dialog";
import { StartSubscriptionDialog } from "@/features/loyalty/components/start-subscription-dialog";
import {
  useCustomerPackages,
  useLoyaltyAccess,
  useLoyaltyCampaigns,
  useLoyaltyMutations,
  useLoyaltyPackages,
  useLoyaltyPlans,
  useSubscriptions,
} from "@/features/loyalty/hooks/use-loyalty";
import {
  packageStateTone,
  renewalLabel,
  rewardLabel,
  subscriptionStateTone,
} from "@/features/loyalty/lib/labels";
import type {
  CustomerPackage,
  LoyaltyCampaign,
  LoyaltyPackage,
  LoyaltyPlan,
  LoyaltyRef,
  Subscription,
} from "@/features/loyalty/services/loyalty.service";
import {
  TenantLiveResources,
  useTenantLiveList,
} from "@/features/organizations/hooks/use-tenant-live";
import { date } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

const ACTIVE_FILTER = [
  { value: "true", labelKey: "common.active", label: "true" },
  { value: "false", labelKey: "common.passive", label: "false" },
];

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useLocale();
  return (
    <StatusChip
      label={active ? t("common.active") : t("common.passive")}
      tone={active ? "success" : "default"}
    />
  );
}

function refsText(services: LoyaltyRef[], categories: LoyaltyRef[]) {
  return [...services, ...categories].map((r) => r.name).join(", ") || "—";
}

function pageCountOf(total: number | undefined, size: number) {
  return Math.max(1, Math.ceil((total ?? 0) / (size || 20)));
}

function Actions({ actions }: { actions: EntityRowAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="flex justify-end">
      <EntityRowActions actions={actions} />
    </div>
  );
}

/* ---------------------------------------------------------------- campaigns */

export function CampaignsTable({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canWrite } = useLoyaltyAccess();
  const { confirmDelete } = useDialogs();
  const { deleteCampaign } = useLoyaltyMutations();
  const [editing, setEditing] = useState<LoyaltyCampaign | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const live = useTenantLiveList(TenantLiveResources.loyaltyPrograms);
  const state = useServerListState({ realtime: live, initialSort: "name" });
  const params = useMemo(
    () => ({
      ...state.params,
      is_active: columnSelectValue(state.columnFilters, "is_active"),
    }),
    [state.params, state.columnFilters],
  );
  const list = useLoyaltyCampaigns(params);

  const remove = useCallback(
    async (c: LoyaltyCampaign) => {
      const ok = await confirmDelete({
        title: t("loyalty.campaigns.delete"),
        description: t("loyalty.campaigns.delete_confirm"),
      });
      if (ok) await deleteCampaign.mutateAsync(c.uuid);
    },
    [confirmDelete, deleteCampaign, t],
  );

  const columns = useMemo<ColumnDef<LoyaltyCampaign>[]>(
    () => [
      createColumn<LoyaltyCampaign>({
        accessorKey: "name",
        labelKey: "loyalty.fields.name",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {refsText(row.original.services, row.original.categories)}
            </span>
          </div>
        ),
      }),
      createColumn<LoyaltyCampaign>({
        accessorKey: "stamps_required",
        labelKey: "loyalty.fields.stamps_required",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {t("loyalty.campaigns.stamps_value", {
              count: row.original.stamps_required,
            })}
          </span>
        ),
      }),
      createColumn<LoyaltyCampaign>({
        id: "reward",
        labelKey: "loyalty.fields.reward",
        cell: ({ row }) => rewardLabel(row.original, t, locale),
      }),
      createColumn<LoyaltyCampaign>({
        id: "window",
        labelKey: "loyalty.fields.validity",
        cell: ({ row }) => {
          const c = row.original;
          if (!c.valid_from && !c.valid_until)
            return t("loyalty.fields.always");
          return `${c.valid_from ? date(c.valid_from, "dd.MM.yyyy", locale) : "…"} – ${
            c.valid_until ? date(c.valid_until, "dd.MM.yyyy", locale) : "…"
          }`;
        },
      }),
      createColumn<LoyaltyCampaign>({
        accessorKey: "is_active",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: ACTIVE_FILTER,
        cell: ({ row }) => <ActiveBadge active={row.original.is_active} />,
      }),
      createColumn<LoyaltyCampaign>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Actions
            actions={
              canWrite
                ? [
                    {
                      id: "edit",
                      label: t("common.edit"),
                      icon: Edit,
                      onSelect: () => setEditing(row.original),
                    },
                    {
                      id: "delete",
                      label: t("common.delete"),
                      icon: Trash2,
                      variant: "destructive",
                      onSelect: () => void remove(row.original),
                    },
                  ]
                : []
            }
          />
        ),
      }),
    ],
    [canWrite, locale, remove, t],
  );

  return (
    <>
      <EntityTable
        realtime={state.realtimeFor(() => list.refetch())}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(r) => r.uuid}
        onRowClick={canWrite ? setEditing : undefined}
        isLoading={list.isLoading}
        isError={list.isError}
        errorDescription={t("loyalty.errors.list")}
        onRetry={() => void list.refetch()}
        emptyTitle={t("loyalty.campaigns.empty_title")}
        emptyDescription={t("loyalty.campaigns.empty_description")}
        pageCount={pageCountOf(list.data?.total, state.pagination.pageSize)}
        state={state.tableState}
        features={{ persistKey: `tenant-loyalty-campaigns-${slug}` }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void list.refetch()}
            refreshDisabled={list.isFetching}
            createLabel={canWrite ? t("loyalty.campaigns.new") : undefined}
            onCreate={canWrite ? () => setCreateOpen(true) : undefined}
          />
        }
      />
      <CampaignDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CampaignDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        campaign={editing}
      />
    </>
  );
}

/* ---------------------------------------------------------------- packages */

export function PackagesTable({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canWrite, canApply } = useLoyaltyAccess();
  const { confirmDelete } = useDialogs();
  const { deletePackage } = useLoyaltyMutations();
  const [editing, setEditing] = useState<LoyaltyPackage | null>(null);
  const [selling, setSelling] = useState<LoyaltyPackage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const live = useTenantLiveList(TenantLiveResources.loyaltyPrograms);
  const state = useServerListState({ realtime: live, initialSort: "name" });
  const params = useMemo(
    () => ({
      ...state.params,
      is_active: columnSelectValue(state.columnFilters, "is_active"),
    }),
    [state.params, state.columnFilters],
  );
  const list = useLoyaltyPackages(params);

  const remove = useCallback(
    async (p: LoyaltyPackage) => {
      const ok = await confirmDelete({
        title: t("loyalty.packages.delete"),
        description: t("loyalty.packages.delete_confirm"),
      });
      if (ok) await deletePackage.mutateAsync(p.uuid);
    },
    [confirmDelete, deletePackage, t],
  );

  const columns = useMemo<ColumnDef<LoyaltyPackage>[]>(
    () => [
      createColumn<LoyaltyPackage>({
        accessorKey: "name",
        labelKey: "loyalty.fields.name",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {row.original.items
                .map((i) => `${i.quantity}× ${i.service_name}`)
                .join(", ")}
            </span>
          </div>
        ),
      }),
      createColumn<LoyaltyPackage>({
        accessorKey: "price",
        labelKey: "loyalty.fields.price",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold tabular-nums">
              {formatFinanceAmount(
                row.original.price,
                row.original.currency,
                locale,
              )}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("loyalty.packages.list_value", {
                value: formatFinanceAmount(
                  row.original.list_value,
                  row.original.currency,
                  locale,
                ),
              })}
            </span>
          </div>
        ),
      }),
      createColumn<LoyaltyPackage>({
        id: "validity",
        labelKey: "loyalty.fields.validity_days",
        cell: ({ row }) =>
          row.original.validity_days
            ? t("loyalty.packages.valid_days", {
                count: row.original.validity_days,
              })
            : t("loyalty.packages.no_expiry"),
      }),
      createColumn<LoyaltyPackage>({
        accessorKey: "sold_count",
        labelKey: "loyalty.packages.sold",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.sold_count}</span>
        ),
      }),
      createColumn<LoyaltyPackage>({
        accessorKey: "is_active",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: ACTIVE_FILTER,
        cell: ({ row }) => <ActiveBadge active={row.original.is_active} />,
      }),
      createColumn<LoyaltyPackage>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const list: EntityRowAction[] = [];
          if (canApply && row.original.is_active) {
            list.push({
              id: "sell",
              label: t("loyalty.sell.title"),
              icon: PackagePlus,
              onSelect: () => setSelling(row.original),
            });
          }
          if (canWrite) {
            list.push(
              {
                id: "edit",
                label: t("common.edit"),
                icon: Edit,
                onSelect: () => setEditing(row.original),
              },
              {
                id: "delete",
                label: t("common.delete"),
                icon: Trash2,
                variant: "destructive",
                onSelect: () => void remove(row.original),
              },
            );
          }
          return <Actions actions={list} />;
        },
      }),
    ],
    [canApply, canWrite, locale, remove, t],
  );

  return (
    <>
      <EntityTable
        realtime={state.realtimeFor(() => list.refetch())}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(r) => r.uuid}
        onRowClick={canWrite ? setEditing : undefined}
        isLoading={list.isLoading}
        isError={list.isError}
        errorDescription={t("loyalty.errors.list")}
        onRetry={() => void list.refetch()}
        emptyTitle={t("loyalty.packages.empty_title")}
        emptyDescription={t("loyalty.packages.empty_description")}
        pageCount={pageCountOf(list.data?.total, state.pagination.pageSize)}
        state={state.tableState}
        features={{ persistKey: `tenant-loyalty-packages-${slug}` }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void list.refetch()}
            refreshDisabled={list.isFetching}
            createLabel={canWrite ? t("loyalty.packages.new") : undefined}
            onCreate={canWrite ? () => setCreateOpen(true) : undefined}
          />
        }
      />
      <PackageDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PackageDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        pkg={editing}
      />
      <SellPackageDialog
        open={Boolean(selling)}
        onOpenChange={(o) => !o && setSelling(null)}
        packageUuid={selling?.uuid}
      />
    </>
  );
}

/* ---------------------------------------------------------------- plans */

export function PlansTable({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canWrite, canApply } = useLoyaltyAccess();
  const { confirmDelete } = useDialogs();
  const { deletePlan } = useLoyaltyMutations();
  const [editing, setEditing] = useState<LoyaltyPlan | null>(null);
  const [starting, setStarting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const live = useTenantLiveList(TenantLiveResources.loyaltyPrograms);
  const state = useServerListState({ realtime: live, initialSort: "name" });
  const params = useMemo(
    () => ({
      ...state.params,
      is_active: columnSelectValue(state.columnFilters, "is_active"),
    }),
    [state.params, state.columnFilters],
  );
  const list = useLoyaltyPlans(params);

  const remove = useCallback(
    async (p: LoyaltyPlan) => {
      const ok = await confirmDelete({
        title: t("loyalty.plans.delete"),
        description: t("loyalty.plans.delete_confirm"),
      });
      if (ok) await deletePlan.mutateAsync(p.uuid);
    },
    [confirmDelete, deletePlan, t],
  );

  const columns = useMemo<ColumnDef<LoyaltyPlan>[]>(
    () => [
      createColumn<LoyaltyPlan>({
        accessorKey: "name",
        labelKey: "loyalty.fields.name",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {refsText(row.original.services, row.original.categories)}
            </span>
          </div>
        ),
      }),
      createColumn<LoyaltyPlan>({
        accessorKey: "price",
        labelKey: "loyalty.fields.price_per_period",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">
            {formatFinanceAmount(
              row.original.price,
              row.original.currency,
              locale,
            )}
            <span className="text-muted-foreground ms-1 text-xs font-normal">
              /{" "}
              {t("loyalty.period.months", {
                count: row.original.period_months,
              })}
            </span>
          </span>
        ),
      }),
      createColumn<LoyaltyPlan>({
        id: "uses",
        labelKey: "loyalty.fields.uses_per_period",
        cell: ({ row }) =>
          row.original.uses_per_period
            ? t("loyalty.plans.uses_short", {
                count: row.original.uses_per_period,
              })
            : t("loyalty.fields.unlimited"),
      }),
      createColumn<LoyaltyPlan>({
        accessorKey: "active_count",
        labelKey: "loyalty.plans.active_count",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.active_count}</span>
        ),
      }),
      createColumn<LoyaltyPlan>({
        accessorKey: "is_active",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: ACTIVE_FILTER,
        cell: ({ row }) => <ActiveBadge active={row.original.is_active} />,
      }),
      createColumn<LoyaltyPlan>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const list: EntityRowAction[] = [];
          if (canApply && row.original.is_active) {
            list.push({
              id: "start",
              label: t("loyalty.start.title"),
              icon: UserPlus,
              onSelect: () => setStarting(true),
            });
          }
          if (canWrite) {
            list.push(
              {
                id: "edit",
                label: t("common.edit"),
                icon: Edit,
                onSelect: () => setEditing(row.original),
              },
              {
                id: "delete",
                label: t("common.delete"),
                icon: Trash2,
                variant: "destructive",
                onSelect: () => void remove(row.original),
              },
            );
          }
          return <Actions actions={list} />;
        },
      }),
    ],
    [canApply, canWrite, locale, remove, t],
  );

  return (
    <>
      <EntityTable
        realtime={state.realtimeFor(() => list.refetch())}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(r) => r.uuid}
        onRowClick={canWrite ? setEditing : undefined}
        isLoading={list.isLoading}
        isError={list.isError}
        errorDescription={t("loyalty.errors.list")}
        onRetry={() => void list.refetch()}
        emptyTitle={t("loyalty.plans.empty_title")}
        emptyDescription={t("loyalty.plans.empty_description")}
        pageCount={pageCountOf(list.data?.total, state.pagination.pageSize)}
        state={state.tableState}
        features={{ persistKey: `tenant-loyalty-plans-${slug}` }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void list.refetch()}
            refreshDisabled={list.isFetching}
            createLabel={canWrite ? t("loyalty.plans.new") : undefined}
            onCreate={canWrite ? () => setCreateOpen(true) : undefined}
          />
        }
      />
      <PlanDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PlanDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        plan={editing}
      />
      <StartSubscriptionDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}

/* ---------------------------------------------------------------- sold packages */

const PACKAGE_STATES = ["active", "expired", "used_up", "cancelled"] as const;

export function CustomerPackagesTable({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canApply } = useLoyaltyAccess();
  const [selling, setSelling] = useState(false);
  const live = useTenantLiveList(TenantLiveResources.loyaltyPackages);
  const state = useServerListState({ realtime: live });
  const params = useMemo(
    () => ({
      ...state.params,
      state: columnSelectValue(state.columnFilters, "state"),
    }),
    [state.params, state.columnFilters],
  );
  const list = useCustomerPackages(params);
  const open = useCallback(
    (p: CustomerPackage) =>
      router.push(routes.tenant.loyalty.customerPackage(slug, p.uuid)),
    [router, slug],
  );

  const columns = useMemo<ColumnDef<CustomerPackage>[]>(
    () => [
      createColumn<CustomerPackage>({
        accessorKey: "customer_name",
        labelKey: "loyalty.fields.customer",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.original.customer_name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {row.original.name}
            </span>
          </div>
        ),
      }),
      createColumn<CustomerPackage>({
        id: "credits",
        labelKey: "loyalty.fields.credits",
        cell: ({ row }) => {
          const p = row.original;
          const left = p.credits_total - p.credits_used;
          return (
            <div className="flex w-36 flex-col gap-1">
              <span className="text-xs tabular-nums">
                {t("loyalty.packages.credits_left", {
                  left,
                  total: p.credits_total,
                })}
              </span>
              <Progress
                value={p.credits_total ? (left / p.credits_total) * 100 : 0}
              />
            </div>
          );
        },
      }),
      createColumn<CustomerPackage>({
        accessorKey: "price",
        labelKey: "loyalty.fields.price",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatFinanceAmount(
              row.original.price,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<CustomerPackage>({
        accessorKey: "purchased_at",
        labelKey: "loyalty.fields.purchased_at",
        cell: ({ row }) =>
          date(row.original.purchased_at, "dd.MM.yyyy", locale),
      }),
      createColumn<CustomerPackage>({
        accessorKey: "expires_at",
        labelKey: "loyalty.fields.expires_at",
        cell: ({ row }) =>
          row.original.expires_at
            ? date(row.original.expires_at, "dd.MM.yyyy", locale)
            : t("loyalty.packages.no_expiry"),
      }),
      createColumn<CustomerPackage>({
        accessorKey: "state",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: PACKAGE_STATES.map((s) => ({
          value: s,
          label: s,
          labelKey: `loyalty.package_state.${s}`,
        })),
        cell: ({ row }) => (
          <StatusChip
            label={t(`loyalty.package_state.${row.original.state}`)}
            tone={packageStateTone(row.original.state)}
          />
        ),
      }),
      createColumn<CustomerPackage>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Actions
            actions={[
              {
                id: "view",
                label: t("common.view"),
                icon: Eye,
                onSelect: () => open(row.original),
              },
            ]}
          />
        ),
      }),
    ],
    [locale, open, t],
  );

  return (
    <>
      <EntityTable
        realtime={state.realtimeFor(() => list.refetch())}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(r) => r.uuid}
        onRowClick={open}
        isLoading={list.isLoading}
        isError={list.isError}
        errorDescription={t("loyalty.errors.list")}
        onRetry={() => void list.refetch()}
        emptyTitle={t("loyalty.sold.empty_title")}
        emptyDescription={t("loyalty.sold.empty_description")}
        pageCount={pageCountOf(list.data?.total, state.pagination.pageSize)}
        state={state.tableState}
        features={{ persistKey: `tenant-loyalty-sold-${slug}` }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void list.refetch()}
            refreshDisabled={list.isFetching}
            createLabel={canApply ? t("loyalty.sell.title") : undefined}
            onCreate={canApply ? () => setSelling(true) : undefined}
          />
        }
      />
      <SellPackageDialog open={selling} onOpenChange={setSelling} />
    </>
  );
}

/* ---------------------------------------------------------------- subscriptions */

const SUB_STATES = ["active", "past_due", "cancelled"] as const;

export function SubscriptionsTable({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canApply } = useLoyaltyAccess();
  const [starting, setStarting] = useState(false);
  const live = useTenantLiveList(TenantLiveResources.loyaltySubscriptions);
  const state = useServerListState({ realtime: live });
  const params = useMemo(
    () => ({
      ...state.params,
      state: columnSelectValue(state.columnFilters, "state"),
    }),
    [state.params, state.columnFilters],
  );
  const list = useSubscriptions(params);
  const open = useCallback(
    (s: Subscription) =>
      router.push(routes.tenant.loyalty.subscription(slug, s.uuid)),
    [router, slug],
  );

  const columns = useMemo<ColumnDef<Subscription>[]>(
    () => [
      createColumn<Subscription>({
        accessorKey: "customer_name",
        labelKey: "loyalty.fields.customer",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{row.original.customer_name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {row.original.name}
              {row.original.plate ? ` · ${row.original.plate}` : ""}
            </span>
          </div>
        ),
      }),
      createColumn<Subscription>({
        accessorKey: "price",
        labelKey: "loyalty.fields.price_per_period",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatFinanceAmount(
              row.original.price,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<Subscription>({
        id: "usage",
        labelKey: "loyalty.fields.this_period",
        cell: ({ row }) => {
          const p = row.original.current_period;
          if (!p) return "—";
          return p.limit
            ? t("loyalty.subscriptions.used_of", {
                used: p.used,
                limit: p.limit,
              })
            : t("loyalty.subscriptions.used_unlimited", { used: p.used });
        },
      }),
      createColumn<Subscription>({
        accessorKey: "renewal_date",
        labelKey: "loyalty.fields.renewal_date",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5 tabular-nums">
              <CalendarClock className="text-muted-foreground size-3.5" />
              {date(row.original.renewal_date, "dd.MM.yyyy", locale)}
            </span>
            {row.original.state !== "cancelled" ? (
              <span className="text-muted-foreground text-xs">
                {renewalLabel(row.original.days_until_renewal, t)}
              </span>
            ) : null}
          </div>
        ),
      }),
      createColumn<Subscription>({
        accessorKey: "state",
        labelKey: "common.status",
        filterVariant: "select",
        filterOptions: SUB_STATES.map((s) => ({
          value: s,
          label: s,
          labelKey: `loyalty.subscription_state.${s}`,
        })),
        cell: ({ row }) => (
          <StatusChip
            label={t(`loyalty.subscription_state.${row.original.state}`)}
            tone={subscriptionStateTone(row.original.state)}
          />
        ),
      }),
      createColumn<Subscription>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Actions
            actions={[
              {
                id: "view",
                label: t("common.view"),
                icon: Eye,
                onSelect: () => open(row.original),
              },
            ]}
          />
        ),
      }),
    ],
    [locale, open, t],
  );

  return (
    <>
      <EntityTable
        realtime={state.realtimeFor(() => list.refetch())}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(r) => r.uuid}
        onRowClick={open}
        isLoading={list.isLoading}
        isError={list.isError}
        errorDescription={t("loyalty.errors.list")}
        onRetry={() => void list.refetch()}
        emptyTitle={t("loyalty.subscriptions.empty_title")}
        emptyDescription={t("loyalty.subscriptions.empty_description")}
        pageCount={pageCountOf(list.data?.total, state.pagination.pageSize)}
        state={state.tableState}
        features={{ persistKey: `tenant-loyalty-subscriptions-${slug}` }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void list.refetch()}
            refreshDisabled={list.isFetching}
            createLabel={canApply ? t("loyalty.start.title") : undefined}
            onCreate={canApply ? () => setStarting(true) : undefined}
          />
        }
      />
      <StartSubscriptionDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}
