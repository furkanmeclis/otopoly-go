"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Coins,
  Package,
  PackageMinus,
  Percent,
  ReceiptText,
  ShoppingCart,
  Truck,
  Wrench,
} from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityAvatar,
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
import { ProductDialog } from "@/features/catalog/components/products/product-dialog";
import { StockAdjustmentDialog } from "@/features/catalog/components/products/stock-adjustment-dialog";
import {
  useProductMovements,
  useProductSummary,
} from "@/features/catalog/hooks/use-catalog-insights";
import { useCatalogProduct } from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import type { ProductMovement } from "@/features/catalog/services/catalog-insights.service";
import {
  formatFinanceAmount,
  formatQuantity,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const TABS = ["overview", "movements"] as const;

function stockTone(status: string): EntityStatTone {
  if (status === "out_of_stock") return "danger";
  if (status === "low_stock") return "warning";
  if (status === "in_stock") return "success";
  return "default";
}

function marginTone(percent: number): EntityStatTone {
  if (percent < 0) return "danger";
  if (percent < 15) return "warning";
  return "success";
}

function movementHref(slug: string, m: ProductMovement) {
  if (m.kind === "purchase")
    return routes.tenant.purchases.detail(slug, m.ref_uuid);
  if (m.kind === "sale") return routes.tenant.sales.detail(slug, m.ref_uuid);
  return routes.tenant.operations.detail(slug, m.ref_uuid);
}

function partyHref(slug: string, m: ProductMovement) {
  if (!m.party_uuid) return null;
  return m.kind === "purchase"
    ? routes.tenant.suppliers.detail(slug, m.party_uuid)
    : routes.tenant.customers.detail(slug, m.party_uuid);
}

export function ProductDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { canWrite } = useTenantCatalogAccess(slug);
  const query = useCatalogProduct(uuid);
  const summaryQuery = useProductSummary(uuid);
  const [tab, setTab] = useDetailTab(TABS);
  const movementsQuery = useProductMovements(uuid);
  const product = query.data;
  const summary = summaryQuery.data;
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const title = product?.name ?? t("catalog.detail.product_title");
  const currency = product?.currency ?? "TRY";
  const unit = product ? catalogUnitLabel(t, product.unit) : "";
  const money = (v?: string | null) => formatFinanceAmount(v, currency, locale);
  const qty = (v?: string | null) =>
    v == null ? "—" : `${formatQuantity(v, locale)} ${unit}`.trim();
  const date = (v?: string | null) =>
    v ? datetime(v, "dd.MM.yyyy", locale) : "—";
  const moneyTick = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const movements = useMemo(
    () => movementsQuery.data?.items ?? [],
    [movementsQuery.data],
  );

  const columns = useMemo<ColumnDef<ProductMovement>[]>(
    () => [
      createColumn<ProductMovement>({
        accessorKey: "occurred_at",
        labelKey: "catalog.insights.columns.date",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.occurred_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      }),
      createColumn<ProductMovement>({
        accessorKey: "kind",
        labelKey: "catalog.insights.columns.kind",
        filterVariant: "faceted",
        filterOptions: ["purchase", "sale", "job"].map((value) => ({
          value,
          label: value,
          labelKey: `catalog.insights.movement_kind.${value}`,
        })),
        gridPrimary: true,
        cell: ({ row }) => {
          const m = row.original;
          const Icon =
            m.kind === "purchase"
              ? Truck
              : m.kind === "sale"
                ? ShoppingCart
                : Wrench;
          return (
            <Link
              href={movementHref(slug, m)}
              className={cn(
                "inline-flex items-center gap-2 font-medium hover:underline",
                !m.effective && "text-muted-foreground line-through",
              )}
            >
              <Icon className="text-muted-foreground size-4" aria-hidden />
              {t(`catalog.insights.movement_kind.${m.kind}`)}
              {m.plate ? (
                <span className="text-muted-foreground font-mono text-xs">
                  {m.plate}
                </span>
              ) : null}
            </Link>
          );
        },
      }),
      createColumn<ProductMovement>({
        accessorKey: "party_name",
        labelKey: "catalog.insights.columns.party",
        filterVariant: "text",
        cell: ({ row }) => {
          const m = row.original;
          const href = partyHref(slug, m);
          const label = m.party_name || "—";
          return href ? (
            <Link href={href} className="hover:underline">
              {label}
            </Link>
          ) : (
            <span>{label}</span>
          );
        },
      }),
      createColumn<ProductMovement>({
        accessorKey: "qty",
        labelKey: "catalog.insights.columns.qty",
        cell: ({ row }) => {
          const v = parseFinanceAmount(row.original.qty);
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium tabular-nums",
                v > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {v > 0 ? (
                <ArrowDownLeft className="size-3.5" aria-hidden />
              ) : (
                <ArrowUpRight className="size-3.5" aria-hidden />
              )}
              {v > 0 ? "+" : ""}
              {formatQuantity(row.original.qty, locale)}
            </span>
          );
        },
      }),
      createColumn<ProductMovement>({
        accessorKey: "unit_price",
        labelKey: "catalog.insights.columns.unit_price",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatFinanceAmount(
              row.original.unit_price,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<ProductMovement>({
        accessorKey: "total",
        labelKey: "catalog.insights.columns.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.total,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
      createColumn<ProductMovement>({
        id: "effective",
        accessorFn: (row) => (row.effective ? "yes" : "no"),
        labelKey: "catalog.insights.columns.status",
        cell: ({ row }) =>
          row.original.effective ? (
            <StatusChip
              label={t("catalog.insights.effective")}
              tone="success"
            />
          ) : (
            <StatusChip label={t("catalog.insights.cancelled")} />
          ),
      }),
    ],
    [locale, slug, t],
  );

  const stockProgress = (() => {
    if (!summary?.stock.tracked) return undefined;
    const q = parseFinanceAmount(summary.stock.quantity);
    const min = parseFinanceAmount(summary.stock.min_alert);
    const target = min > 0 ? min * 2 : Math.max(q, 1);
    return (q / target) * 100;
  })();

  const recent = movements.slice(0, 5);

  return (
    <EntityPage
      title={title}
      description={t("catalog.detail.product_description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        {
          label: t("catalog.products.title"),
          href: routes.tenant.catalog.products.root(slug),
        },
        { label: title },
      ]}
      actions={
        canWrite && product ? (
          <EntityActions>
            {product.track_stock ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAdjusting(true)}
              >
                <Boxes className="size-4" />
                {t("catalog.products.adjust_stock")}
              </Button>
            ) : null}
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
          description={t("catalog.detail.product_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {product ? (
        <div className="space-y-6">
          <EntityHeader
            leading={<EntityAvatar name={product.name} icon={Package} />}
            title={product.name}
            badges={
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  label={
                    product.is_active ? t("common.active") : t("common.passive")
                  }
                  tone={product.is_active ? "success" : "default"}
                />
                <StatusChip
                  label={t(`catalog.stock_status.${product.stock_status}`)}
                  tone={
                    product.stock_status === "out_of_stock"
                      ? "danger"
                      : product.stock_status === "low_stock"
                        ? "warning"
                        : product.stock_status === "untracked"
                          ? "default"
                          : "success"
                  }
                />
                {product.category_uuid && product.category_name ? (
                  <Link
                    href={routes.tenant.catalog.categories.detail(
                      slug,
                      product.category_uuid,
                    )}
                    className="inline-flex"
                  >
                    <StatusChip label={product.category_name} />
                  </Link>
                ) : null}
              </div>
            }
            subtitle={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {product.sku ? (
                  <span>
                    {t("catalog.products.sku")}:{" "}
                    <span className="font-mono">{product.sku}</span>
                  </span>
                ) : null}
                {product.barcode ? (
                  <span>
                    {t("catalog.products.barcode")}:{" "}
                    <span className="font-mono">{product.barcode}</span>
                  </span>
                ) : null}
                <span>
                  {t("catalog.products.unit")}: {unit}
                </span>
              </span>
            }
            aside={
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {t("catalog.products.sale_price")}
                </p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {money(product.sale_price)}
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {t("catalog.insights.cost_and_vat", {
                    cost: money(product.cost_price),
                    vat: product.vat_rate,
                  })}
                </p>
              </div>
            }
          />

          <EntityStatGrid>
            <EntityStatTile
              icon={Boxes}
              label={t("catalog.insights.stock")}
              loading={summaryQuery.isLoading}
              value={
                product.track_stock
                  ? qty(summary?.stock.quantity ?? product.stock_quantity)
                  : t("catalog.stock_status.untracked")
              }
              tone={stockTone(summary?.stock.status ?? product.stock_status)}
              progress={stockProgress}
              hint={
                product.track_stock
                  ? t("catalog.insights.stock_min", {
                      min: qty(product.min_stock_alert),
                    })
                  : undefined
              }
            />
            <EntityStatTile
              icon={Coins}
              label={t("catalog.insights.stock_value")}
              loading={summaryQuery.isLoading}
              value={money(summary?.stock.cost_value)}
              hint={t("catalog.insights.stock_sale_value", {
                value: money(summary?.stock.sale_value),
              })}
            />
            <EntityStatTile
              icon={Percent}
              label={t("catalog.insights.unit_margin")}
              loading={summaryQuery.isLoading}
              value={money(summary?.pricing.unit_margin)}
              tone={marginTone(summary?.pricing.margin_percent ?? 0)}
              hint={t("catalog.insights.margin_percent", {
                percent: (summary?.pricing.margin_percent ?? 0).toLocaleString(
                  locale === "tr" ? "tr-TR" : "en-US",
                ),
              })}
            />
            {summary?.sales ? (
              <EntityStatTile
                icon={ShoppingCart}
                label={t("catalog.insights.sold")}
                value={qty(summary.sales.sold_qty)}
                hint={t("catalog.insights.sold_hint", {
                  count: summary.sales.sale_count,
                  revenue: money(summary.sales.revenue),
                })}
                href={routes.tenant.sales.root(slug)}
              />
            ) : summary?.jobs ? (
              <EntityStatTile
                icon={Wrench}
                label={t("catalog.insights.used_on_jobs")}
                value={qty(summary.jobs.consumed_qty)}
                hint={t("catalog.insights.used_on_jobs_hint", {
                  count: summary.jobs.consumption_job_count,
                })}
              />
            ) : null}
          </EntityStatGrid>

          {summary?.sales || summary?.purchases || summary?.jobs ? (
            <EntityStatGrid>
              {summary.sales ? (
                <EntityStatTile
                  icon={ReceiptText}
                  label={t("catalog.insights.last_sale")}
                  value={money(summary.sales.last_sale_price)}
                  hint={date(summary.sales.last_sold_at)}
                />
              ) : null}
              {summary.purchases ? (
                <EntityStatTile
                  icon={Truck}
                  label={t("catalog.insights.last_purchase")}
                  value={money(summary.purchases.last_purchase_cost)}
                  hint={t("catalog.insights.last_purchase_hint", {
                    date: date(summary.purchases.last_purchased_at),
                    avg: money(summary.purchases.avg_unit_cost),
                  })}
                />
              ) : null}
              {summary.purchases ? (
                <EntityStatTile
                  icon={ArrowDownLeft}
                  label={t("catalog.insights.purchased")}
                  value={qty(summary.purchases.purchased_qty)}
                  hint={t("catalog.insights.purchased_hint", {
                    count: summary.purchases.purchase_count,
                    spend: money(summary.purchases.spend),
                  })}
                  href={routes.tenant.purchases.root(slug)}
                />
              ) : null}
              {summary.jobs && summary.sales ? (
                <EntityStatTile
                  icon={PackageMinus}
                  label={t("catalog.insights.used_on_jobs")}
                  value={qty(summary.jobs.consumed_qty)}
                  hint={t("catalog.insights.used_on_jobs_hint", {
                    count: summary.jobs.consumption_job_count,
                  })}
                />
              ) : null}
            </EntityStatGrid>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <EntityTabsList
              items={[
                {
                  value: "overview",
                  label: t("catalog.insights.tabs.overview"),
                },
                {
                  value: "movements",
                  label: t("catalog.insights.tabs.movements"),
                  badge: movements.length,
                },
              ]}
            />

            <TabsContent value="overview" className="mt-4 space-y-6">
              <div className="grid gap-6 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  {summary?.sales ? (
                    <EntityTrendChart
                      title={t("catalog.insights.sales_trend")}
                      description={t("catalog.insights.sales_trend_hint")}
                      points={summary.sales.monthly}
                      series={[
                        {
                          key: "amount",
                          label: t("catalog.insights.revenue"),
                        },
                      ]}
                      valueFormatter={(v) => money(String(v))}
                      tickValueFormatter={moneyTick}
                      emptyTitle={t("catalog.insights.no_sales_yet")}
                    />
                  ) : null}
                  <EntitySectionCard
                    title={t("catalog.insights.recent_movements")}
                    badge={movements.length || undefined}
                    action={
                      movements.length > recent.length ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          onClick={() => setTab("movements")}
                        >
                          {t("catalog.insights.view_all")}
                        </Button>
                      ) : null
                    }
                  >
                    {movementsQuery.isLoading ? (
                      <p className="text-muted-foreground text-sm">
                        {t("common.loading")}
                      </p>
                    ) : recent.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t("catalog.insights.no_movements")}
                      </p>
                    ) : (
                      <ul className="divide-border divide-y text-sm">
                        {recent.map((m) => {
                          const v = parseFinanceAmount(m.qty);
                          return (
                            <li
                              key={`${m.kind}-${m.ref_uuid}-${m.occurred_at}`}
                            >
                              <Link
                                href={movementHref(slug, m)}
                                className="hover:bg-muted/40 -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2"
                              >
                                <div className="min-w-0">
                                  <p
                                    className={cn(
                                      "truncate font-medium",
                                      !m.effective &&
                                        "text-muted-foreground line-through",
                                    )}
                                  >
                                    {t(
                                      `catalog.insights.movement_kind.${m.kind}`,
                                    )}
                                    {m.party_name ? ` · ${m.party_name}` : ""}
                                  </p>
                                  <p className="text-muted-foreground text-xs tabular-nums">
                                    {datetime(
                                      m.occurred_at,
                                      "dd.MM.yyyy HH:mm",
                                      locale,
                                    )}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    "shrink-0 font-medium tabular-nums",
                                    v > 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-red-600 dark:text-red-400",
                                  )}
                                >
                                  {v > 0 ? "+" : ""}
                                  {formatQuantity(m.qty, locale)} {unit}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </EntitySectionCard>
                </div>

                <div className="space-y-6 lg:col-span-2">
                  <EntitySectionCard title={t("catalog.detail.product_info")}>
                    <EntityDetail
                      sections={[
                        {
                          id: "pricing",
                          fields: [
                            {
                              key: "cost",
                              label: t("catalog.products.cost_price"),
                              value: money(product.cost_price),
                            },
                            {
                              key: "sale",
                              label: t("catalog.products.sale_price"),
                              value: money(product.sale_price),
                            },
                            {
                              key: "vat",
                              label: t("catalog.products.vat_rate"),
                              value: `%${product.vat_rate}`,
                            },
                            {
                              key: "currency",
                              label: t("catalog.products.currency"),
                              value: product.currency,
                            },
                          ],
                        },
                        {
                          id: "stock",
                          fields: [
                            {
                              key: "track",
                              label: t("catalog.products.track_stock"),
                              value: product.track_stock
                                ? t("common.yes")
                                : t("common.no"),
                            },
                            {
                              key: "min",
                              label: t("catalog.products.min_stock_alert"),
                              value: qty(product.min_stock_alert),
                            },
                            {
                              key: "created",
                              label: t("catalog.detail.created_at"),
                              value: datetime(
                                product.created_at,
                                "dd.MM.yyyy HH:mm",
                                locale,
                              ),
                            },
                            {
                              key: "updated",
                              label: t("catalog.detail.updated_at"),
                              value: datetime(
                                product.updated_at,
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
                    title={t("catalog.products.description_field")}
                  >
                    <p
                      className={cn(
                        "text-sm whitespace-pre-line",
                        !product.description && "text-muted-foreground",
                      )}
                    >
                      {product.description ||
                        t("catalog.insights.no_description")}
                    </p>
                  </EntitySectionCard>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="movements" className="mt-4">
              <EntitySectionCard
                title={t("catalog.insights.tabs.movements")}
                badge={movements.length}
              >
                <p className="text-muted-foreground mb-3 text-xs">
                  {t("catalog.insights.movements_hint")}
                </p>
                <EntityTable
                  columns={columns}
                  data={movements}
                  getRowId={(row) =>
                    `${row.kind}-${row.ref_uuid}-${row.occurred_at}-${row.qty}`
                  }
                  isLoading={movementsQuery.isLoading}
                  isError={movementsQuery.isError}
                  onRetry={() => void movementsQuery.refetch()}
                  emptyTitle={t("catalog.insights.no_movements")}
                  emptyDescription={t("catalog.insights.no_movements_hint")}
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
          </Tabs>
        </div>
      ) : null}

      <ProductDialog
        open={editing}
        onOpenChange={setEditing}
        product={product}
      />
      <StockAdjustmentDialog
        open={adjusting}
        onOpenChange={setAdjusting}
        product={product ?? null}
      />
    </EntityPage>
  );
}
