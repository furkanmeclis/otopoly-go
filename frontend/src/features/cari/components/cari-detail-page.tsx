"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Minus, Plus, Wallet } from "lucide-react";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityHeader,
  EntityPage,
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  EntityToolbar,
  useServerListState,
  type EntityRowAction,
} from "@/components/entity";
import {
  AppDatePicker,
  AppForm,
  AppInput,
  AppSelect,
  AppTextarea,
} from "@/components/forms";
import { createColumn } from "@/components/tables";
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
import { routes } from "@/config/routes";
import {
  useCariAccount,
  useCariEntries,
  useCariMutations,
} from "@/features/cari/hooks/use-cari";
import { useTenantCariAccess } from "@/features/cari/hooks/use-tenant-cari-access";
import type { CariEntry } from "@/features/cari/services/cari.service";
import {
  financeToday,
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { ResourceIOToolbar } from "@/features/io";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

const PAYMENT_METHODS = ["cash", "card", "transfer", "other"] as const;

function columnSelectValue(
  columnFilters: { id: string; value: unknown }[],
  id: string,
) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

function columnDateRange(
  columnFilters: { id: string; value: unknown }[],
  id: string,
) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value as
    [string | undefined, string | undefined] | undefined;
  return {
    from: raw?.[0]?.trim() || undefined,
    to: raw?.[1]?.trim() || undefined,
  };
}

function entryTypeLabelKey(type: string) {
  return `cari.entry_type.${type}` as const;
}

function entryStatusTone(status: string) {
  return status === "void" ? ("default" as const) : ("success" as const);
}

export function CariDetailPage({ slug, uuid }: { slug: string; uuid: string }) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useTenantCariAccess(slug);
  const accountQuery = useCariAccount(uuid);
  const mutations = useCariMutations();

  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const listState = useServerListState({
    initialSort: "-entry_date",
    initialPageSize: 25,
  });

  const listParams = useMemo(() => {
    const dates = columnDateRange(listState.columnFilters, "entry_date");
    return {
      ...listState.params,
      type: columnSelectValue(listState.columnFilters, "type"),
      status: columnSelectValue(listState.columnFilters, "status"),
      date_from: dates.from,
      date_to: dates.to,
    };
  }, [listState.columnFilters, listState.params]);

  const entriesQuery = useCariEntries(uuid, listParams);
  const account = accountQuery.data;

  const handleVoid = useCallback(
    async (entry: CariEntry) => {
      const confirmed = await confirm({
        title: t("cari.void.title"),
        description: t("cari.void.description"),
        confirmLabel: t("cari.void.confirm"),
        variant: "destructive",
      });
      if (!confirmed) return;
      await mutations.voidEntry.mutateAsync({
        entryUuid: entry.uuid,
        accountUuid: uuid,
      });
    },
    [confirm, mutations.voidEntry, t, uuid],
  );

  const columns = useMemo<ColumnDef<CariEntry>[]>(() => {
    const base: ColumnDef<CariEntry>[] = [
      createColumn<CariEntry>({
        accessorKey: "entry_date",
        labelKey: "cari.entry_date",
        enableSorting: true,
        filterVariant: "date-range",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap tabular-nums">
            {row.original.entry_date}
          </span>
        ),
      }),
      createColumn<CariEntry>({
        accessorKey: "type",
        labelKey: "cari.entry_type",
        filterVariant: "select",
        filterOptions: ["charge", "payment", "adjustment", "opening"].map(
          (value) => ({
            value,
            labelKey: entryTypeLabelKey(value),
            label: value,
          }),
        ),
        cell: ({ row }) => t(entryTypeLabelKey(row.original.type)),
      }),
      createColumn<CariEntry>({
        accessorKey: "status",
        labelKey: "cari.entry_status",
        filterVariant: "select",
        filterOptions: [
          { value: "posted", labelKey: "cari.status.posted", label: "posted" },
          { value: "void", labelKey: "cari.status.void", label: "void" },
        ],
        cell: ({ row }) => (
          <StatusChip
            label={t(`cari.status.${row.original.status}`)}
            tone={entryStatusTone(row.original.status)}
          />
        ),
      }),
      createColumn<CariEntry>({
        accessorKey: "amount",
        labelKey: "cari.amount",
        cell: ({ row }) =>
          formatFinanceAmount(row.original.amount, account?.currency, locale),
      }),
      createColumn<CariEntry>({
        accessorKey: "balance_after",
        labelKey: "cari.balance_after",
        cell: ({ row }) =>
          formatFinanceAmount(
            row.original.balance_after,
            account?.currency,
            locale,
          ),
      }),
      createColumn<CariEntry>({
        accessorKey: "description",
        labelKey: "cari.description",
        cell: ({ row }) => row.original.description || "—",
      }),
      createColumn<CariEntry>({
        id: "finance_account",
        labelKey: "cari.finance_account",
        accessorFn: (row) => row.finance_account_name ?? "",
        cell: ({ row }) => row.original.finance_account_name || "—",
      }),
    ];

    if (canWrite) {
      base.push({
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          if (row.original.status !== "posted") return null;
          const actions: EntityRowAction[] = [
            {
              id: "void",
              label: t("cari.void.confirm"),
              icon: Ban,
              variant: "destructive",
              onSelect: () => void handleVoid(row.original),
            },
          ];
          return <EntityRowActions actions={actions} />;
        },
      });
    }

    return base;
  }, [account?.currency, canWrite, handleVoid, locale, t]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("cari.forbidden")}
      />
    );
  }

  const title = account?.customer_name ?? t("cari.detail.title");
  const balance = parseFinanceAmount(account?.balance);
  const pageCount = Math.max(
    1,
    Math.ceil((entriesQuery.data?.total ?? 0) / (listParams.limit || 25)),
  );

  return (
    <EntityPage
      title={title}
      description={t("cari.detail.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        { label: t("cari.title"), href: routes.tenant.cari.root(slug) },
        { label: title },
      ]}
      actions={
        account && canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setChargeOpen(true)}
            >
              <Plus className="size-4" />
              {t("cari.actions.charge")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setPaymentOpen(true)}
            >
              <Wallet className="size-4" />
              {t("cari.actions.payment")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdjustmentOpen(true)}
            >
              <Minus className="size-4" />
              {t("cari.actions.adjustment")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {accountQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {accountQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("cari.error_description")}
          onRetry={() => void accountQuery.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {account ? (
        <div className="space-y-6">
          <EntityHeader
            title={account.customer_name}
            subtitle={
              account.customer_phone || account.customer_email || undefined
            }
            badges={
              <>
                <StatusChip
                  label={
                    account.is_active ? t("common.active") : t("common.passive")
                  }
                  tone={account.is_active ? "success" : "default"}
                />
                <Link
                  href={routes.tenant.customers.detail(
                    slug,
                    account.customer_uuid,
                  )}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  {t("cari.detail.view_customer")}
                </Link>
              </>
            }
          />

          <div className="bg-muted/40 border-border rounded-xl border p-6">
            <p className="text-muted-foreground text-sm">{t("cari.balance")}</p>
            <p
              className={
                balance > 0
                  ? "text-3xl font-semibold tracking-tight text-amber-700 tabular-nums dark:text-amber-400"
                  : "text-3xl font-semibold tracking-tight tabular-nums"
              }
            >
              {formatFinanceAmount(account.balance, account.currency, locale)}
            </p>
            {balance > 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t("cari.detail.receivable_hint")}
              </p>
            ) : null}
          </div>

          <EntitySectionCard
            title={t("cari.detail.entries")}
            badge={entriesQuery.data?.total}
          >
            <EntityTable
              columns={columns}
              data={entriesQuery.data?.items ?? []}
              getRowId={(row) => row.uuid}
              isLoading={entriesQuery.isLoading}
              isError={entriesQuery.isError}
              errorDescription={t("cari.detail.entries_error")}
              onRetry={() => void entriesQuery.refetch()}
              emptyTitle={t("cari.detail.entries_empty")}
              emptyDescription={t("cari.detail.entries_empty_description")}
              pageCount={pageCount}
              state={listState.tableState}
              manual={{ filtering: true, sorting: true, pagination: true }}
              features={{
                persistKey: `tenant-cari-entries-${uuid}`,
                columnFilters: true,
              }}
              toolbarExtra={
                <>
                  <ResourceIOToolbar
                    resource="tenant.cari.entries"
                    exportPath={`/v1/tenant/cari/${uuid}/entries/export`}
                    query={{
                      type: listParams.type,
                      status: listParams.status,
                      date_from: listParams.date_from,
                      date_to: listParams.date_to,
                      sort: listParams.sort,
                    }}
                    capabilities={{ export: true }}
                    jobsHref={routes.tenant.exports.root(slug)}
                    scope="tenant"
                  />
                  <EntityToolbar
                    onRefresh={() => void entriesQuery.refetch()}
                    refreshDisabled={entriesQuery.isFetching}
                  />
                </>
              }
            />
          </EntitySectionCard>
        </div>
      ) : null}

      <ChargeDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        pending={mutations.charge.isPending}
        onSubmit={async (body) => {
          await mutations.charge.mutateAsync({ accountUuid: uuid, body });
          setChargeOpen(false);
        }}
      />
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        pending={mutations.payment.isPending}
        onSubmit={async (body) => {
          await mutations.payment.mutateAsync({ accountUuid: uuid, body });
          setPaymentOpen(false);
        }}
      />
      <AdjustmentDialog
        open={adjustmentOpen}
        onOpenChange={setAdjustmentOpen}
        pending={mutations.adjustment.isPending}
        onSubmit={async (body) => {
          await mutations.adjustment.mutateAsync({ accountUuid: uuid, body });
          setAdjustmentOpen(false);
        }}
      />
    </EntityPage>
  );
}

function ChargeDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: {
    amount: string;
    entry_date: string;
    description?: string;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const today = useMemo(() => financeToday(), []);
  const schema = useMemo(
    () =>
      z.object({
        amount: z.string().min(1, t("cari.validation.amount")),
        entry_date: z.string().min(1, t("cari.validation.date")),
        description: z.string().optional(),
      }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cari.actions.charge")}</DialogTitle>
          <DialogDescription>{t("cari.charge.description")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "charge-open" : "charge-closed"}
          schema={schema}
          defaultValues={{ amount: "", entry_date: today, description: "" }}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="amount"
              label={t("cari.amount")}
              placeholder="0.00"
              required
            />
            <AppDatePicker name="entry_date" label={t("cari.entry_date")} />
            <AppTextarea name="description" label={t("cari.description")} />
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

function PaymentDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: {
    amount: string;
    entry_date: string;
    finance_account_uuid: string;
    payment_method: "cash" | "card" | "transfer" | "other";
    description?: string;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const today = useMemo(() => financeToday(), []);
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const accounts = accountsQuery.data?.items ?? [];
  const defaultAccountUuid =
    accounts.find((account) => account.is_default)?.uuid ??
    accounts[0]?.uuid ??
    "";

  const schema = useMemo(
    () =>
      z.object({
        amount: z.string().min(1, t("cari.validation.amount")),
        entry_date: z.string().min(1, t("cari.validation.date")),
        finance_account_uuid: z
          .string()
          .min(1, t("cari.validation.finance_account")),
        payment_method: z.enum(PAYMENT_METHODS).default("cash"),
        description: z.string().optional(),
      }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cari.actions.payment")}</DialogTitle>
          <DialogDescription>{t("cari.payment.description")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? `payment-open-${defaultAccountUuid}` : "payment-closed"}
          schema={schema}
          defaultValues={{
            amount: "",
            entry_date: today,
            finance_account_uuid: defaultAccountUuid,
            payment_method: "cash",
            description: "",
          }}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppSelect
              name="finance_account_uuid"
              label={t("cari.finance_account")}
              placeholder={t("cari.payment.select_account")}
              options={accounts.map((account) => ({
                value: account.uuid,
                label: `${account.name} (${account.currency})`,
              }))}
            />
            <AppInput
              name="amount"
              label={t("cari.amount")}
              placeholder="0.00"
              required
            />
            <AppDatePicker name="entry_date" label={t("cari.entry_date")} />
            <AppSelect
              name="payment_method"
              label={t("cari.payment_method")}
              options={PAYMENT_METHODS.map((method) => ({
                value: method,
                label: t(`cari.payment_method.${method}`),
              }))}
            />
            <AppTextarea name="description" label={t("cari.description")} />
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

function AdjustmentDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: {
    amount: string;
    direction: "increase" | "decrease";
    entry_date: string;
    description?: string;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const today = useMemo(() => financeToday(), []);
  const schema = useMemo(
    () =>
      z.object({
        amount: z.string().min(1, t("cari.validation.amount")),
        direction: z.enum(["increase", "decrease"]),
        entry_date: z.string().min(1, t("cari.validation.date")),
        description: z.string().optional(),
      }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cari.actions.adjustment")}</DialogTitle>
          <DialogDescription>
            {t("cari.adjustment.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "adjustment-open" : "adjustment-closed"}
          schema={schema}
          defaultValues={{
            amount: "",
            direction: "increase",
            entry_date: today,
            description: "",
          }}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppSelect
              name="direction"
              label={t("cari.adjustment.direction")}
              options={[
                {
                  value: "increase",
                  label: t("cari.adjustment.increase"),
                },
                {
                  value: "decrease",
                  label: t("cari.adjustment.decrease"),
                },
              ]}
            />
            <AppInput
              name="amount"
              label={t("cari.amount")}
              placeholder="0.00"
              required
            />
            <AppDatePicker name="entry_date" label={t("cari.entry_date")} />
            <AppTextarea name="description" label={t("cari.description")} />
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
