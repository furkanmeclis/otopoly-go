"use client";

import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import {
  AlertTriangle,
  FilePlus2,
  PackageX,
  Search,
  Settings2,
  SlidersHorizontal,
  TrendingDown,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import {
  EntityActions,
  EntityPage,
  EntityRowActions,
  EntityStatTile,
  EntityTable,
  EntityToolbar,
} from "@/components/entity";
import { createSelectColumnDef } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import {
  formatFinanceAmount,
  formatQuantity,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { ReorderDraftsTable } from "@/features/stock-reorder/components/drafts-table";
import { ReorderOverrideDialog } from "@/features/stock-reorder/components/override-dialog";
import {
  ExplainButton,
  StockMeter,
  UrgencyBadge,
  urgencyLabelKey,
} from "@/features/stock-reorder/components/reorder-bits";
import { ReorderSettingsDialog } from "@/features/stock-reorder/components/settings-dialog";
import {
  useReorderSuggestions,
  useStockReorderAccess,
  useStockReorderMutations,
} from "@/features/stock-reorder/hooks/use-stock-reorder";
import type {
  ReorderSuggestion,
  ReorderUrgency,
} from "@/features/stock-reorder/services/stock-reorder.service";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

const URGENCY_TABS = ["all", "out_of_stock", "below_min", "low_cover"] as const;
type UrgencyTab = (typeof URGENCY_TABS)[number];
const NO_SUPPLIER = "none";
const ALL_SUPPLIERS = "all";

type SupplierGroup = {
  key: string;
  name: string;
  items: ReorderSuggestion[];
  total: number;
};

export function StockReorderPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useStockReorderAccess(slug);
  const mutations = useStockReorderMutations();

  const [view, setView] = useState<"suggestions" | "drafts">(
    searchParams.get("tab") === "drafts" ? "drafts" : "suggestions",
  );
  const [urgency, setUrgency] = useState<UrgencyTab>("all");
  const [supplier, setSupplier] = useState(ALL_SUPPLIERS);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [groupBySupplier, setGroupBySupplier] = useState(true);
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overrideItem, setOverrideItem] = useState<ReorderSuggestion | null>(
    null,
  );

  const params = useMemo(
    () => ({
      urgency: urgency === "all" ? undefined : (urgency as ReorderUrgency),
      q: q || undefined,
      all: showAll || undefined,
    }),
    [q, showAll, urgency],
  );
  const listQuery = useReorderSuggestions(params, canRead);
  useTenantLiveRefetch(
    [
      TenantLiveResources.stockReorder,
      TenantLiveResources.catalogProducts,
      TenantLiveResources.purchases,
    ],
    listQuery.refetch,
    { enabled: canRead },
  );

  const allItems = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allItems) {
      if (item.supplier) map.set(item.supplier.uuid, item.supplier.name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [allItems, locale]);

  const items = useMemo(() => {
    let rows = allItems;
    if (supplier === NO_SUPPLIER) rows = rows.filter((r) => !r.supplier);
    else if (supplier !== ALL_SUPPLIERS)
      rows = rows.filter((r) => r.supplier?.uuid === supplier);
    if (groupBySupplier) {
      rows = [...rows].sort((a, b) =>
        (a.supplier?.name ?? "￿").localeCompare(
          b.supplier?.name ?? "￿",
          locale,
        ),
      );
    }
    return rows;
  }, [allItems, groupBySupplier, locale, supplier]);

  const qtyOf = useCallback(
    (item: ReorderSuggestion) =>
      qtyEdits[item.product_uuid] ?? item.suggested_qty,
    [qtyEdits],
  );

  const selected = useMemo(
    () => items.filter((item) => rowSelection[item.product_uuid]),
    [items, rowSelection],
  );

  const groups = useMemo<SupplierGroup[]>(() => {
    const source = selected.length > 0 ? selected : items;
    const map = new Map<string, SupplierGroup>();
    for (const item of source) {
      if (parseFinanceAmount(qtyOf(item)) <= 0) continue;
      const key = item.supplier?.uuid ?? NO_SUPPLIER;
      const group = map.get(key) ?? {
        key,
        name: item.supplier?.name ?? t("stock_reorder.no_supplier"),
        items: [],
        total: 0,
      };
      group.items.push(item);
      group.total +=
        parseFinanceAmount(qtyOf(item)) * parseFinanceAmount(item.unit_cost);
      map.set(key, group);
    }
    return [...map.values()];
  }, [items, qtyOf, selected, t]);

  const selectGroup = (group: SupplierGroup) => {
    const next: RowSelectionState = {};
    for (const item of group.items) next[item.product_uuid] = true;
    setRowSelection(next);
  };

  const createDrafts = async () => {
    const chosen = selected.filter(
      (item) => parseFinanceAmount(qtyOf(item)) > 0,
    );
    if (chosen.length === 0) return;
    const missing = chosen.filter((item) => !item.supplier);
    if (missing.length > 0) {
      await confirm({
        title: t("stock_reorder.drafts_dialog.missing_supplier_title"),
        description: t("stock_reorder.drafts_dialog.missing_supplier", {
          names: missing
            .slice(0, 5)
            .map((m) => m.name)
            .join(", "),
        }),
        confirmLabel: t("common.close"),
      });
      return;
    }
    const supplierCount = new Set(chosen.map((c) => c.supplier?.uuid)).size;
    const ok = await confirm({
      title: t("stock_reorder.drafts_dialog.title"),
      description: t("stock_reorder.drafts_dialog.description", {
        products: chosen.length,
        suppliers: supplierCount,
      }),
      confirmLabel: t("stock_reorder.actions.create_drafts"),
    });
    if (!ok) return;
    await mutations.createDrafts.mutateAsync({
      items: chosen.map((item) => ({
        product_uuid: item.product_uuid,
        qty: qtyOf(item).replace(",", "."),
      })),
    });
    setRowSelection({});
    setQtyEdits({});
    setView("drafts");
  };

  const columns = useMemo<ColumnDef<ReorderSuggestion>[]>(
    () => [
      ...(canWrite ? [createSelectColumnDef<ReorderSuggestion>()] : []),
      {
        accessorKey: "name",
        header: t("stock_reorder.columns.product"),
        meta: { label: t("stock_reorder.columns.product"), gridPrimary: true },
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <Link
              href={routes.tenant.catalog.products.detail(
                slug,
                row.original.product_uuid,
              )}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.sku ? (
              <p className="text-muted-foreground text-xs">
                {row.original.sku}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "urgency",
        header: t("stock_reorder.columns.urgency"),
        meta: { label: t("stock_reorder.columns.urgency") },
        cell: ({ row }) => <UrgencyBadge urgency={row.original.urgency} />,
      },
      {
        id: "stock",
        header: t("stock_reorder.columns.stock"),
        meta: { label: t("stock_reorder.columns.stock") },
        accessorFn: (row) => parseFinanceAmount(row.stock),
        cell: ({ row }) => <StockMeter item={row.original} />,
      },
      {
        id: "velocity",
        header: t("stock_reorder.columns.velocity"),
        meta: {
          label: t("stock_reorder.columns.velocity"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
        },
        accessorFn: (row) => parseFinanceAmount(row.velocity_per_day),
        cell: ({ row }) => (
          <div className="text-right text-sm tabular-nums">
            <p>
              {t("stock_reorder.per_day", {
                value: formatQuantity(row.original.velocity_per_day, locale),
              })}
            </p>
            <p className="text-muted-foreground text-xs">
              {row.original.days_of_cover === null
                ? t("stock_reorder.no_usage")
                : t("stock_reorder.cover_days", {
                    value: formatQuantity(row.original.days_of_cover, locale),
                  })}
            </p>
          </div>
        ),
      },
      {
        id: "on_order",
        header: t("stock_reorder.columns.on_order"),
        meta: {
          label: t("stock_reorder.columns.on_order"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
          defaultHidden: false,
        },
        accessorFn: (row) => parseFinanceAmount(row.on_order),
        cell: ({ row }) =>
          parseFinanceAmount(row.original.on_order) > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {formatQuantity(row.original.on_order, locale)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "supplier",
        header: t("stock_reorder.columns.supplier"),
        meta: { label: t("stock_reorder.columns.supplier") },
        accessorFn: (row) => row.supplier?.name ?? "",
        cell: ({ row }) =>
          row.original.supplier ? (
            <div className="min-w-[8rem]">
              <Link
                href={routes.tenant.suppliers.detail(
                  slug,
                  row.original.supplier.uuid,
                )}
                className="text-sm hover:underline"
              >
                {row.original.supplier.name}
              </Link>
              <p className="text-muted-foreground text-xs">
                {row.original.supplier.source === "product"
                  ? t("stock_reorder.supplier_source.product")
                  : t("stock_reorder.supplier_source.last_purchase")}
              </p>
            </div>
          ) : canWrite ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setOverrideItem(row.original)}
            >
              <Truck className="size-3.5" />
              {t("stock_reorder.set_supplier")}
            </Button>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t("stock_reorder.no_supplier")}
            </span>
          ),
      },
      {
        id: "unit_cost",
        header: t("stock_reorder.columns.unit_cost"),
        meta: {
          label: t("stock_reorder.columns.unit_cost"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
        },
        accessorFn: (row) => parseFinanceAmount(row.unit_cost),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatFinanceAmount(
              row.original.unit_cost,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      },
      {
        id: "suggested_qty",
        header: t("stock_reorder.columns.suggested"),
        meta: {
          label: t("stock_reorder.columns.suggested"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
        },
        accessorFn: (row) => parseFinanceAmount(row.suggested_qty),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-col items-end gap-0.5">
              {canWrite ? (
                <Input
                  className="h-8 w-20 text-right tabular-nums"
                  inputMode="decimal"
                  value={qtyOf(item)}
                  aria-label={t("stock_reorder.columns.suggested")}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setQtyEdits((prev) => ({
                      ...prev,
                      [item.product_uuid]: e.target.value,
                    }))
                  }
                />
              ) : (
                <span className="font-semibold tabular-nums">
                  {formatQuantity(item.suggested_qty, locale)}
                </span>
              )}
              {item.pack_size ? (
                <span className="text-muted-foreground text-[11px]">
                  {t("stock_reorder.packs", {
                    count: item.packs ?? 0,
                    size: formatQuantity(item.pack_size, locale),
                  })}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "estimated_total",
        header: t("stock_reorder.columns.total"),
        meta: {
          label: t("stock_reorder.columns.total"),
          cellClassName: "text-right",
          headerClassName: "text-right [&>div]:justify-end",
        },
        accessorFn: (row) =>
          parseFinanceAmount(qtyOf(row)) * parseFinanceAmount(row.unit_cost),
        cell: ({ getValue, row }) => (
          <span className="font-semibold whitespace-nowrap tabular-nums">
            {formatFinanceAmount(
              getValue<number>(),
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
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <ExplainButton item={row.original} />
            {canWrite ? (
              <EntityRowActions
                actions={[
                  {
                    id: "override",
                    label: t("stock_reorder.override.title"),
                    icon: SlidersHorizontal,
                    onSelect: () => setOverrideItem(row.original),
                  },
                ]}
              />
            ) : null}
          </div>
        ),
      },
    ],
    [canWrite, locale, qtyOf, slug, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("stock_reorder.forbidden")}
      />
    );
  }

  const locked = listQuery.isError && isFeatureDisabledError(listQuery.error);
  const summary = listQuery.data?.summary;
  const currency = items[0]?.currency ?? "TRY";

  return (
    <EntityPage
      title={t("stock_reorder.title")}
      description={t("stock_reorder.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("purchases.title"),
          href: routes.tenant.purchases.root(slug),
        },
        { label: t("stock_reorder.title") },
      ]}
      actions={
        locked ? null : (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
              {t("stock_reorder.actions.settings")}
            </Button>
          </EntityActions>
        )
      }
    >
      {locked ? (
        <FeatureLocked slug={slug} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <EntityStatTile
              label={t("stock_reorder.urgency.out_of_stock")}
              value={summary?.out_of_stock ?? 0}
              icon={PackageX}
              tone={summary?.out_of_stock ? "danger" : "default"}
              loading={listQuery.isLoading}
            />
            <EntityStatTile
              label={t("stock_reorder.urgency.below_min")}
              value={summary?.below_min ?? 0}
              icon={AlertTriangle}
              tone={summary?.below_min ? "warning" : "default"}
              loading={listQuery.isLoading}
            />
            <EntityStatTile
              label={t("stock_reorder.urgency.low_cover")}
              value={summary?.low_cover ?? 0}
              icon={TrendingDown}
              tone={summary?.low_cover ? "warning" : "default"}
              loading={listQuery.isLoading}
            />
            <EntityStatTile
              label={t("stock_reorder.summary.drafts")}
              value={summary?.drafts ?? 0}
              icon={FilePlus2}
              loading={listQuery.isLoading}
            />
          </div>

          <Tabs
            value={view}
            onValueChange={(v) => setView(v as "suggestions" | "drafts")}
            className="mb-4"
          >
            <TabsList>
              <TabsTrigger value="suggestions">
                {t("stock_reorder.tabs.suggestions")}
              </TabsTrigger>
              <TabsTrigger value="drafts">
                {t("stock_reorder.tabs.drafts")}
                {summary?.drafts ? (
                  <Badge variant="secondary" className="ml-1.5">
                    {summary.drafts}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {view === "drafts" ? (
            <ReorderDraftsTable
              slug={slug}
              canWrite={canWrite}
              onOpen={(uuid) =>
                router.push(routes.tenant.purchases.detail(slug, uuid))
              }
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setQ(searchInput.trim());
                    }}
                    onBlur={() => setQ(searchInput.trim())}
                    placeholder={t("stock_reorder.search_placeholder")}
                    className="pl-9"
                  />
                </div>
                <Select value={supplier} onValueChange={setSupplier}>
                  <SelectTrigger className="w-[12rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SUPPLIERS}>
                      {t("stock_reorder.filter.all_suppliers")}
                    </SelectItem>
                    <SelectItem value={NO_SUPPLIER}>
                      {t("stock_reorder.no_supplier")}
                    </SelectItem>
                    {supplierOptions.map(([uuid, name]) => (
                      <SelectItem key={uuid} value={uuid}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch
                    id="reorder-group"
                    checked={groupBySupplier}
                    onCheckedChange={setGroupBySupplier}
                  />
                  <Label htmlFor="reorder-group" className="text-sm">
                    {t("stock_reorder.filter.group_by_supplier")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="reorder-all"
                    checked={showAll}
                    onCheckedChange={setShowAll}
                  />
                  <Label htmlFor="reorder-all" className="text-sm">
                    {t("stock_reorder.filter.show_all")}
                  </Label>
                </div>
                <EntityToolbar
                  onRefresh={() => void listQuery.refetch()}
                  refreshDisabled={listQuery.isFetching}
                />
              </div>

              <Tabs
                value={urgency}
                onValueChange={(v) => setUrgency(v as UrgencyTab)}
                className="mb-4"
              >
                <TabsList>
                  {URGENCY_TABS.map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {tab === "all"
                        ? t("stock_reorder.filter.all")
                        : t(urgencyLabelKey(tab))}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {groupBySupplier && groups.length > 0 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {groups.map((group) => (
                    <Button
                      key={group.key}
                      type="button"
                      variant="outline"
                      disabled={!canWrite}
                      onClick={() => selectGroup(group)}
                      className="h-auto min-w-[11rem] flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left"
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Truck className="text-muted-foreground size-3.5" />
                        <span className="truncate">{group.name}</span>
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t("stock_reorder.group_summary", {
                          count: group.items.length,
                          total: formatFinanceAmount(
                            group.total,
                            currency,
                            locale,
                          ),
                        })}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : null}

              {canWrite ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm">
                    {selected.length > 0
                      ? t("stock_reorder.selected", { count: selected.length })
                      : t("stock_reorder.select_hint")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      selected.length === 0 || mutations.createDrafts.isPending
                    }
                    onClick={() => void createDrafts()}
                  >
                    <FilePlus2 className="size-4" />
                    {t("stock_reorder.actions.create_drafts")}
                  </Button>
                </div>
              ) : null}

              <EntityTable
                columns={columns}
                data={items}
                getRowId={(row) => row.product_uuid}
                isLoading={listQuery.isLoading}
                isError={listQuery.isError}
                errorDescription={t("stock_reorder.error")}
                onRetry={() => void listQuery.refetch()}
                emptyTitle={t("stock_reorder.empty_title")}
                emptyDescription={t("stock_reorder.empty_hint")}
                manual={{ filtering: false, sorting: false, pagination: false }}
                state={{
                  rowSelection,
                  onRowSelectionChange: setRowSelection,
                }}
                features={{
                  persistKey: `tenant-stock-reorder-${slug}`,
                  sorting: !groupBySupplier,
                  globalFilter: false,
                  columnFilters: false,
                  facetedFilters: false,
                  rowSelection: canWrite,
                  pagination: false,
                }}
              />
            </>
          )}
        </>
      )}

      <ReorderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        canWrite={canWrite}
      />
      <ReorderOverrideDialog
        item={overrideItem}
        onOpenChange={(open) => {
          if (!open) setOverrideItem(null);
        }}
      />
    </EntityPage>
  );
}
