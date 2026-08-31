"use client";

import { useMemo } from "react";
import { Ban } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { StatusChip } from "@/components/common/status-chip";
import { EntityRowActions, type EntityRowAction } from "@/components/entity";
import { createColumn } from "@/components/tables";
import {
  formatFinanceAmount,
  truncateText,
} from "@/features/finance/lib/format";
import {
  transactionStatusHintKey,
  transactionStatusLabelKey,
  transactionTypeLabelKey,
} from "@/features/finance/lib/labels";
import type { FinanceTransaction } from "@/features/finance/services/finance.service";
import { useLocale } from "@/providers/locale-provider";

export const TX_TYPE_VALUES = ["income", "expense", "transfer"] as const;
export const TX_STATUS_VALUES = ["posted", "void"] as const;

export type FinanceTransactionFilterOptions = {
  accounts: Array<{ value: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
};

export type FinanceTransactionRowHandlers = {
  onVoid?: (tx: FinanceTransaction) => void;
  canWrite?: boolean;
};

function statusTone(status: string) {
  return status === "void" ? ("default" as const) : ("success" as const);
}

export function FinanceTransactionRowActionsMenu({
  tx,
  handlers,
}: {
  tx: FinanceTransaction;
  handlers: FinanceTransactionRowHandlers;
}) {
  const { t } = useLocale();

  const actions = useMemo<EntityRowAction[]>(() => {
    if (!handlers.canWrite || tx.status !== "posted" || !handlers.onVoid)
      return [];
    return [
      {
        id: "void",
        label: t("finance.transactions.void"),
        icon: Ban,
        variant: "destructive",
        onSelect: () => handlers.onVoid?.(tx),
      },
    ];
  }, [handlers, t, tx]);

  if (!actions.length) return null;
  return <EntityRowActions actions={actions} />;
}

export function useFinanceTransactionsColumns(
  handlers: FinanceTransactionRowHandlers,
  filterOptions?: FinanceTransactionFilterOptions,
) {
  const { t, locale } = useLocale();

  return useMemo<ColumnDef<FinanceTransaction>[]>(
    () => [
      createColumn<FinanceTransaction>({
        accessorKey: "transaction_date",
        labelKey: "finance.transactions.date",
        enableSorting: true,
        minSize: 200,
        size: 220,
        filterVariant: "date-range",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap tabular-nums">
            {row.original.transaction_date}
          </span>
        ),
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "type",
        labelKey: "finance.transactions.type",
        enableSorting: true,
        minSize: 120,
        filterVariant: "select",
        filterOptions: TX_TYPE_VALUES.map((value) => ({
          value,
          labelKey: transactionTypeLabelKey(value),
          label: value,
        })),
        cell: ({ row }) => t(transactionTypeLabelKey(row.original.type)),
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "amount",
        labelKey: "finance.transactions.amount",
        enableSorting: true,
        minSize: 120,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatFinanceAmount(
              row.original.amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "account_uuid",
        labelKey: "finance.transactions.account",
        enableSorting: false,
        minSize: 140,
        filterVariant: "select",
        filterOptions: filterOptions?.accounts ?? [],
        cell: ({ row }) => row.original.account_name,
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "category_uuid",
        labelKey: "finance.transactions.category",
        enableSorting: false,
        minSize: 140,
        filterVariant: "select",
        filterOptions: filterOptions?.categories ?? [],
        cell: ({ row }) => row.original.category_name ?? "—",
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "description",
        labelKey: "finance.transactions.description",
        enableSorting: false,
        minSize: 200,
        size: 280,
        filterVariant: "text",
        cell: ({ row }) => {
          const text = row.original.description?.trim();
          if (!text) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span
              className="text-muted-foreground line-clamp-2 block max-w-xs text-sm leading-snug"
              title={text}
            >
              {truncateText(text, 80)}
            </span>
          );
        },
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "status",
        labelKey: "finance.transactions.status",
        minSize: 120,
        filterVariant: "select",
        filterOptions: TX_STATUS_VALUES.map((value) => ({
          value,
          labelKey: transactionStatusLabelKey(value),
          label: value,
        })),
        cell: ({ row }) => (
          <span title={t(transactionStatusHintKey(row.original.status))}>
            <StatusChip
              label={t(transactionStatusLabelKey(row.original.status))}
              tone={statusTone(row.original.status)}
            />
          </span>
        ),
      }),
      createColumn<FinanceTransaction>({
        accessorKey: "currency",
        labelKey: "finance.transactions.currency",
        minSize: 100,
        filterVariant: "text",
        defaultHidden: true,
      }),
      createColumn<FinanceTransaction>({
        id: "actions",
        labelKey: "finance.columns.actions",
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <FinanceTransactionRowActionsMenu
            tx={row.original}
            handlers={handlers}
          />
        ),
      }),
    ],
    [filterOptions?.accounts, filterOptions?.categories, handlers, locale, t],
  );
}
