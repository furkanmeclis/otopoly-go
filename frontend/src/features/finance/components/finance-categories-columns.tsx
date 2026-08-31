"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { createColumn } from "@/components/tables";
import type { FinanceCategory } from "@/features/finance/services/finance.service";
import { useLocale } from "@/providers/locale-provider";

export const CATEGORY_KIND_VALUES = ["income", "expense"] as const;

export function useFinanceCategoriesColumns() {
  const { t } = useLocale();

  return useMemo<ColumnDef<FinanceCategory>[]>(
    () => [
      createColumn<FinanceCategory>({
        accessorKey: "name",
        labelKey: "finance.categories.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      }),
      createColumn<FinanceCategory>({
        accessorKey: "kind",
        labelKey: "finance.categories.kind",
        filterVariant: "faceted",
        filterOptions: CATEGORY_KIND_VALUES.map((value) => ({
          value,
          labelKey:
            value === "income"
              ? "finance.categories.kind_income"
              : "finance.categories.kind_expense",
          label: value,
        })),
        cell: ({ row }) =>
          row.original.kind === "income"
            ? t("finance.categories.kind_income")
            : t("finance.categories.kind_expense"),
      }),
      createColumn<FinanceCategory>({
        accessorKey: "sort_order",
        labelKey: "finance.categories.sort_order",
        enableSorting: true,
        defaultHidden: true,
      }),
    ],
    [t],
  );
}
