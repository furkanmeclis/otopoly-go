"use client";

import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { EntityRowActions, type EntityRowAction } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { accountTypeLabelKey } from "@/features/finance/lib/labels";
import type { FinanceAccount } from "@/features/finance/services/finance.service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type FinanceAccountRowHandlers = {
  onDelete?: (account: FinanceAccount) => void;
  canWrite?: boolean;
};

export function FinanceAccountRowActionsMenu({
  account,
  handlers,
}: {
  account: FinanceAccount;
  handlers: FinanceAccountRowHandlers;
}) {
  const { t } = useLocale();

  const actions = useMemo<EntityRowAction[]>(() => {
    if (!handlers.canWrite || account.is_default || !handlers.onDelete)
      return [];
    return [
      {
        id: "delete",
        label: t("common.delete"),
        icon: Trash2,
        variant: "destructive",
        onSelect: () => handlers.onDelete?.(account),
      },
    ];
  }, [account, handlers, t]);

  if (!actions.length) return null;
  return <EntityRowActions actions={actions} />;
}

export function useFinanceAccountsColumns(handlers: FinanceAccountRowHandlers) {
  const { t, locale } = useLocale();

  return useMemo<ColumnDef<FinanceAccount>[]>(
    () => [
      createColumn<FinanceAccount>({
        accessorKey: "name",
        labelKey: "finance.accounts.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            {row.original.is_default ? (
              <Badge variant="secondary" className="text-[10px]">
                {t("finance.accounts.default")}
              </Badge>
            ) : null}
          </div>
        ),
      }),
      createColumn<FinanceAccount>({
        accessorKey: "type",
        labelKey: "finance.accounts.type",
        cell: ({ row }) => t(accountTypeLabelKey(row.original.type)),
      }),
      createColumn<FinanceAccount>({
        accessorKey: "currency",
        labelKey: "finance.accounts.currency",
        enableSorting: true,
        filterVariant: "text",
      }),
      createColumn<FinanceAccount>({
        accessorKey: "current_balance",
        labelKey: "finance.accounts.current_balance",
        enableSorting: true,
        cell: ({ row }) => (
          <span
            className={cn(
              "font-semibold tabular-nums",
              row.original.negative_balance && "text-destructive",
            )}
          >
            {formatFinanceAmount(
              row.original.current_balance,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<FinanceAccount>({
        accessorKey: "is_active",
        labelKey: "finance.accounts.is_active",
        filterVariant: "faceted",
        filterOptions: [
          { value: "true", labelKey: "finance.filters.active", label: "true" },
          {
            value: "false",
            labelKey: "finance.filters.inactive",
            label: "false",
          },
        ],
        defaultHidden: true,
        cell: ({ row }) =>
          row.original.is_active
            ? t("finance.filters.active")
            : t("finance.filters.inactive"),
      }),
      createColumn<FinanceAccount>({
        id: "actions",
        labelKey: "finance.columns.actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <FinanceAccountRowActionsMenu
            account={row.original}
            handlers={handlers}
          />
        ),
      }),
    ],
    [handlers, locale, t],
  );
}
