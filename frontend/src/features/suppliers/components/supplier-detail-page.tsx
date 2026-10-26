"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarClock,
  Coins,
  Mail,
  Package,
  Pencil,
  Phone,
  ReceiptText,
  Trash2,
  Truck,
} from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
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
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { useTenantPurchasesAccess } from "@/features/purchases/hooks/use-tenant-purchases-access";
import { SupplierDialog } from "@/features/suppliers/components/suppliers-page";
import {
  useSupplier,
  useSupplierMutations,
  useSupplierSummary,
} from "@/features/suppliers/hooks/use-suppliers";
import { useTenantSuppliersAccess } from "@/features/suppliers/hooks/use-tenant-suppliers-access";
import type { SupplierSummary } from "@/features/suppliers/services/suppliers.service";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";

const TABS = ["overview", "purchases", "products"] as const;

type Block = NonNullable<SupplierSummary["purchases"]>;
type PurchaseRow = Block["recent"][number];
type ProductRow = Block["top_products"][number];

const SUB_TABLE_FEATURES = {
  rowSelection: false,
  columnOrdering: false,
  columnPinning: false,
  columnResizing: false,
  viewMode: false,
} as const;

export function SupplierDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canRead, canWrite } = useTenantSuppliersAccess(slug);
  const { canRead: canReadPurchases } = useTenantPurchasesAccess(slug);
  const query = useSupplier(uuid);
  const summaryQuery = useSupplierSummary(uuid);
  useTenantLiveRefetch(TenantLiveResources.suppliers, query.refetch, { uuid });
  useTenantLiveRefetch(TenantLiveResources.purchases, summaryQuery.refetch);
  const mutations = useSupplierMutations();
  const [tab, setTab] = useDetailTab(TABS);
  const [editing, setEditing] = useState(false);
  const supplier = query.data;
  const block = summaryQuery.data?.purchases ?? null;
  const title = supplier?.name ?? t("suppliers.title");
  const money = (v?: string | null, currency = "TRY") =>
    formatFinanceAmount(v, currency, locale);
  const date = (v?: string | null) =>
    v ? datetime(v, "dd.MM.yyyy", locale) : "—";
  const moneyTick = (v: number) =>
    new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  const purchaseColumns = useMemo<ColumnDef<PurchaseRow>[]>(
    () => [
      createColumn<PurchaseRow>({
        accessorKey: "purchased_at",
        labelKey: "suppliers.insights.columns.date",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.purchases.detail(slug, row.original.uuid)}
            className="font-medium tabular-nums hover:underline"
          >
            {datetime(row.original.purchased_at, "dd.MM.yyyy HH:mm", locale)}
          </Link>
        ),
      }),
      createColumn<PurchaseRow>({
        accessorKey: "method",
        labelKey: "suppliers.insights.columns.method",
        filterVariant: "faceted",
        filterOptions: ["cash", "card"].map((value) => ({
          value,
          label: value,
          labelKey: `purchases.payment_method.${value}`,
        })),
        cell: ({ row }) => t(`purchases.payment_method.${row.original.method}`),
      }),
      createColumn<PurchaseRow>({
        accessorKey: "line_count",
        labelKey: "suppliers.insights.columns.lines",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.line_count}</span>
        ),
      }),
      createColumn<PurchaseRow>({
        accessorKey: "status",
        labelKey: "suppliers.insights.columns.status",
        cell: ({ row }) => (
          <StatusChip
            label={t(`purchases.status.${row.original.status}`)}
            tone={row.original.status === "posted" ? "success" : "danger"}
          />
        ),
      }),
      createColumn<PurchaseRow>({
        accessorKey: "total_amount",
        labelKey: "suppliers.insights.columns.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.total_amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );

  const productColumns = useMemo<ColumnDef<ProductRow>[]>(
    () => [
      createColumn<ProductRow>({
        accessorKey: "name",
        labelKey: "suppliers.insights.columns.product",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.catalog.products.detail(
              slug,
              row.original.product_uuid,
            )}
            className="inline-flex items-center gap-2 font-medium hover:underline"
          >
            <Package className="text-muted-foreground size-4" aria-hidden />
            {row.original.name}
          </Link>
        ),
      }),
      createColumn<ProductRow>({
        accessorKey: "qty",
        labelKey: "suppliers.insights.columns.qty",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(row.original.qty, locale)}{" "}
            {catalogUnitLabel(t, row.original.unit)}
          </span>
        ),
      }),
      createColumn<ProductRow>({
        accessorKey: "spend",
        labelKey: "suppliers.insights.columns.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(row.original.spend, "TRY", locale)}
          </span>
        ),
      }),
      createColumn<ProductRow>({
        accessorKey: "last_purchased_at",
        labelKey: "suppliers.insights.columns.last_purchase",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.last_purchased_at
              ? datetime(row.original.last_purchased_at, "dd.MM.yyyy", locale)
              : "—"}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("suppliers.forbidden")}
      />
    );
  }

  return (
    <EntityPage
      title={title}
      description={t("suppliers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("suppliers.title"),
          href: routes.tenant.suppliers.root(slug),
        },
        { label: title },
      ]}
      actions={
        supplier && canWrite ? (
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
              variant="outline"
              onClick={async () => {
                const confirmed = await confirmDelete({
                  title: t("suppliers.detail.delete"),
                  description: t("suppliers.detail.delete_confirm"),
                });
                if (!confirmed) return;
                await mutations.remove.mutateAsync(uuid);
                router.push(routes.tenant.suppliers.root(slug));
              }}
            >
              <Trash2 className="size-4" />
              {t("suppliers.detail.delete")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("suppliers.error_description")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {supplier ? (
        <div className="space-y-6">
          <EntityHeader
            leading={<EntityAvatar name={supplier.name} icon={Truck} />}
            title={supplier.name}
            subtitle={
              supplier.phone || supplier.email ? (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {supplier.phone ? (
                    <a
                      href={`tel:${supplier.phone}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Phone className="size-3.5" aria-hidden />
                      {supplier.phone}
                    </a>
                  ) : null}
                  {supplier.email ? (
                    <a
                      href={`mailto:${supplier.email}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Mail className="size-3.5" aria-hidden />
                      {supplier.email}
                    </a>
                  ) : null}
                </span>
              ) : undefined
            }
            badges={
              <StatusChip
                label={
                  supplier.is_active ? t("common.active") : t("common.passive")
                }
                tone={supplier.is_active ? "success" : "default"}
              />
            }
            aside={
              block ? (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">
                    {t("suppliers.insights.total_spend")}
                  </p>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {money(block.spend)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("suppliers.insights.last_purchase_value", {
                      date: date(block.last_purchased_at),
                    })}
                  </p>
                </div>
              ) : null
            }
          />

          {block ? (
            <EntityStatGrid>
              <EntityStatTile
                icon={ReceiptText}
                label={t("suppliers.insights.purchases")}
                value={block.purchase_count}
                hint={t("suppliers.insights.avg_purchase", {
                  amount: money(block.avg_purchase),
                })}
              />
              <EntityStatTile
                icon={Coins}
                label={t("suppliers.insights.total_spend")}
                value={money(block.spend)}
              />
              <EntityStatTile
                icon={Package}
                label={t("suppliers.insights.products")}
                value={block.product_count}
                hint={
                  block.top_products[0]
                    ? t("suppliers.insights.top_product", {
                        name: block.top_products[0].name,
                      })
                    : undefined
                }
              />
              <EntityStatTile
                icon={CalendarClock}
                label={t("suppliers.insights.last_purchase")}
                value={date(block.last_purchased_at)}
                hint={t("suppliers.insights.first_purchase", {
                  date: date(block.first_purchased_at),
                })}
              />
            </EntityStatGrid>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <EntityTabsList
              items={[
                {
                  value: "overview",
                  label: t("suppliers.insights.tabs.overview"),
                },
                {
                  value: "purchases",
                  label: t("suppliers.insights.tabs.purchases"),
                  badge: block?.purchase_count ?? null,
                  hidden: !canReadPurchases,
                },
                {
                  value: "products",
                  label: t("suppliers.insights.tabs.products"),
                  badge: block?.product_count ?? null,
                  hidden: !canReadPurchases,
                },
              ]}
            />

            <TabsContent value="overview" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  {block ? (
                    <EntityTrendChart
                      title={t("suppliers.insights.spend_trend")}
                      description={t("suppliers.insights.spend_trend_hint")}
                      points={block.monthly}
                      series={[
                        {
                          key: "amount",
                          label: t("suppliers.insights.total_spend"),
                        },
                      ]}
                      valueFormatter={(v) => money(String(v))}
                      tickValueFormatter={moneyTick}
                      emptyTitle={t("suppliers.insights.no_purchases")}
                    />
                  ) : !canReadPurchases ? (
                    <EmptyState
                      title={t("common.error_forbidden")}
                      description={t("suppliers.insights.no_permission")}
                    />
                  ) : null}
                </div>
                <div className="space-y-6 lg:col-span-2">
                  <EntitySectionCard title={t("suppliers.detail.info")}>
                    <EntityDetail
                      sections={[
                        {
                          id: "info",
                          fields: [
                            {
                              key: "phone",
                              label: t("suppliers.fields.phone"),
                              value: supplier.phone || "—",
                            },
                            {
                              key: "email",
                              label: t("suppliers.fields.email"),
                              value: supplier.email || "—",
                            },
                            {
                              key: "tax_id",
                              label: t("suppliers.fields.tax_id"),
                              value: supplier.tax_id || "—",
                            },
                            {
                              key: "created",
                              label: t("suppliers.created_at"),
                              value: datetime(
                                supplier.created_at,
                                "dd.MM.yyyy HH:mm",
                                locale,
                              ),
                            },
                          ],
                        },
                      ]}
                    />
                  </EntitySectionCard>
                  <EntitySectionCard title={t("suppliers.fields.notes")}>
                    <p
                      className={cn(
                        "text-sm whitespace-pre-line",
                        !supplier.notes && "text-muted-foreground",
                      )}
                    >
                      {supplier.notes || t("suppliers.insights.no_notes")}
                    </p>
                  </EntitySectionCard>
                </div>
              </div>
            </TabsContent>

            {canReadPurchases ? (
              <TabsContent value="purchases" className="mt-4">
                <EntitySectionCard
                  title={t("suppliers.insights.tabs.purchases")}
                  badge={block?.purchase_count}
                >
                  <EntityTable
                    columns={purchaseColumns}
                    data={block?.recent ?? []}
                    getRowId={(row) => row.uuid}
                    isLoading={summaryQuery.isLoading}
                    isError={summaryQuery.isError}
                    onRetry={() => void summaryQuery.refetch()}
                    emptyTitle={t("suppliers.insights.no_purchases")}
                    emptyDescription={t("suppliers.insights.no_purchases_hint")}
                    features={SUB_TABLE_FEATURES}
                  />
                </EntitySectionCard>
              </TabsContent>
            ) : null}

            {canReadPurchases ? (
              <TabsContent value="products" className="mt-4">
                <EntitySectionCard
                  title={t("suppliers.insights.tabs.products")}
                  badge={block?.top_products.length}
                >
                  <EntityTable
                    columns={productColumns}
                    data={block?.top_products ?? []}
                    getRowId={(row) => row.product_uuid}
                    isLoading={summaryQuery.isLoading}
                    emptyTitle={t("suppliers.insights.no_products")}
                    emptyDescription={t("suppliers.insights.no_purchases_hint")}
                    features={SUB_TABLE_FEATURES}
                  />
                </EntitySectionCard>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      ) : null}

      <SupplierDialog
        open={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
        supplier={editing ? supplier : null}
      />
    </EntityPage>
  );
}
