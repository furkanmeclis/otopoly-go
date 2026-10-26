"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { EntityRowActions, EntityTable } from "@/components/entity";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import {
  TenantLiveResources,
  useTenantLiveTable,
} from "@/features/organizations/hooks/use-tenant-live";
import { usePurchases } from "@/features/purchases/hooks/use-purchases";
import type { PurchaseListItem } from "@/features/purchases/services/purchases.service";
import { PostDraftDialog } from "@/features/stock-reorder/components/post-draft-dialog";
import { useStockReorderMutations } from "@/features/stock-reorder/hooks/use-stock-reorder";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

const DRAFT_PARAMS = {
  limit: 100,
  offset: 0,
  status: "draft",
  sort: "-purchased_at",
};

/** Open draft purchases with "Onayla ve alışa çevir" and delete. */
export function ReorderDraftsTable({
  slug,
  canWrite,
  onOpen,
}: {
  slug: string;
  canWrite: boolean;
  onOpen: (uuid: string) => void;
}) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const listQuery = usePurchases(DRAFT_PARAMS);
  const live = useTenantLiveTable(
    TenantLiveResources.purchases,
    listQuery.refetch,
  );
  const { deleteDraft } = useStockReorderMutations();
  const [posting, setPosting] = useState<PurchaseListItem | null>(null);

  const columns = useMemo<ColumnDef<PurchaseListItem>[]>(
    () => [
      {
        accessorKey: "purchased_at",
        header: t("stock_reorder.drafts.created"),
        meta: { label: t("stock_reorder.drafts.created") },
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap tabular-nums">
            {datetime(row.original.created_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      },
      {
        accessorKey: "supplier_name",
        header: t("purchases.supplier"),
        meta: { label: t("purchases.supplier"), gridPrimary: true },
        cell: ({ row }) => (
          <span className="font-medium">{row.original.supplier_name}</span>
        ),
      },
      {
        id: "products",
        header: t("purchases.products"),
        meta: { label: t("purchases.products") },
        enableSorting: false,
        cell: ({ row }) => (
          <ul className="space-y-0.5 py-1 text-sm">
            {row.original.lines.map((line) => (
              <li key={line.uuid} className="flex flex-wrap gap-x-2">
                <span>{line.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  × {formatQuantity(line.qty, locale)}
                </span>
              </li>
            ))}
          </ul>
        ),
      },
      {
        id: "total",
        header: t("purchases.total"),
        meta: {
          label: t("purchases.total"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
        },
        cell: ({ row }) => (
          <span className="font-semibold whitespace-nowrap tabular-nums">
            {formatFinanceAmount(
              row.original.total_amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          canWrite ? (
            <EntityRowActions
              actions={[
                {
                  id: "post",
                  label: t("stock_reorder.actions.post"),
                  icon: CheckCircle2,
                  onSelect: () => setPosting(row.original),
                },
                {
                  id: "delete",
                  label: t("stock_reorder.actions.delete_draft"),
                  icon: Trash2,
                  variant: "destructive",
                  onSelect: () => {
                    void (async () => {
                      const ok = await confirm({
                        title: t("stock_reorder.delete_draft.title"),
                        description: t(
                          "stock_reorder.delete_draft.description",
                        ),
                        confirmLabel: t("common.delete"),
                        variant: "destructive",
                      });
                      if (ok) await deleteDraft.mutateAsync(row.original.uuid);
                    })();
                  },
                },
              ]}
            />
          ) : null,
      },
    ],
    [canWrite, confirm, deleteDraft, locale, t],
  );

  return (
    <>
      <EntityTable
        realtime={live}
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) => onOpen(row.uuid)}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("stock_reorder.drafts.empty_title")}
        emptyDescription={t("stock_reorder.drafts.empty_hint")}
        manual={{ filtering: false, sorting: false, pagination: false }}
        features={{
          persistKey: `tenant-reorder-drafts-${slug}`,
          globalFilter: false,
          columnFilters: false,
          facetedFilters: false,
          rowSelection: false,
          pagination: false,
        }}
      />
      <PostDraftDialog
        draft={posting}
        onOpenChange={(open) => {
          if (!open) setPosting(null);
        }}
      />
    </>
  );
}
