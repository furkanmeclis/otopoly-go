"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { StatusChip } from "@/components/common/status-chip";
import { EntityTable } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import type {
  LoyaltyUsage,
  SubscriptionPayment,
} from "@/features/loyalty/services/loyalty.service";
import { date, datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export const SUB_TABLE_FEATURES = {
  rowSelection: false,
  columnOrdering: false,
  columnPinning: false,
  columnResizing: false,
  viewMode: false,
} as const;

/** Jobs a package / subscription was used on. */
export function UsageTable({
  slug,
  rows,
  currency,
}: {
  slug: string;
  rows: LoyaltyUsage[];
  currency: string;
}) {
  const { t, locale } = useLocale();
  const columns = useMemo<ColumnDef<LoyaltyUsage>[]>(
    () => [
      createColumn<LoyaltyUsage>({
        accessorKey: "created_at",
        labelKey: "loyalty.fields.date",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.created_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      }),
      createColumn<LoyaltyUsage>({
        accessorKey: "plate",
        labelKey: "loyalty.fields.job",
        cell: ({ row }) => (
          <Link
            href={routes.tenant.operations.detail(slug, row.original.job_uuid)}
            className="inline-flex items-center gap-2 hover:underline"
          >
            <PlateBadge plate={row.original.plate} size="sm" />
            <span className="text-muted-foreground truncate text-xs">
              {row.original.line_name}
            </span>
          </Link>
        ),
      }),
      createColumn<LoyaltyUsage>({
        accessorKey: "units",
        labelKey: "loyalty.fields.units",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.units}</span>
        ),
      }),
      createColumn<LoyaltyUsage>({
        accessorKey: "discount_amount",
        labelKey: "loyalty.fields.covered",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatFinanceAmount(
              row.original.discount_amount,
              currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<LoyaltyUsage>({
        accessorKey: "status",
        labelKey: "common.status",
        cell: ({ row }) => (
          <StatusChip
            label={t(`loyalty.application_status.${row.original.status}`)}
            tone={row.original.status === "applied" ? "success" : "default"}
          />
        ),
      }),
    ],
    [currency, locale, slug, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.uuid}
      emptyTitle={t("loyalty.usage.empty_title")}
      emptyDescription={t("loyalty.usage.empty_description")}
      features={SUB_TABLE_FEATURES}
    />
  );
}

/** Paid periods of a subscription. */
export function PaymentsTable({ rows }: { rows: SubscriptionPayment[] }) {
  const { t, locale } = useLocale();
  const columns = useMemo<ColumnDef<SubscriptionPayment>[]>(
    () => [
      createColumn<SubscriptionPayment>({
        accessorKey: "period_start",
        labelKey: "loyalty.fields.period",
        gridPrimary: true,
        cell: ({ row }) => {
          const end = new Date(`${row.original.period_end}T00:00:00`);
          end.setDate(end.getDate() - 1);
          return (
            <span className="tabular-nums">
              {date(row.original.period_start, "dd.MM.yyyy", locale)} –{" "}
              {date(end, "dd.MM.yyyy", locale)}
            </span>
          );
        },
      }),
      createColumn<SubscriptionPayment>({
        accessorKey: "method",
        labelKey: "loyalty.fields.method",
        cell: ({ row }) => (
          <span>
            {t(`loyalty.method.${row.original.method}`)}
            {row.original.finance_account_name ? (
              <span className="text-muted-foreground ms-1 text-xs">
                · {row.original.finance_account_name}
              </span>
            ) : null}
          </span>
        ),
      }),
      createColumn<SubscriptionPayment>({
        accessorKey: "amount",
        labelKey: "loyalty.fields.amount",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<SubscriptionPayment>({
        accessorKey: "created_at",
        labelKey: "loyalty.fields.paid_at",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.created_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      }),
    ],
    [locale, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.uuid}
      emptyTitle={t("loyalty.payments.empty_title")}
      emptyDescription={t("loyalty.payments.empty_description")}
      features={SUB_TABLE_FEATURES}
    />
  );
}
