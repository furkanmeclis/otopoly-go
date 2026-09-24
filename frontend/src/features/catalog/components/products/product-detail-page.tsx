"use client";

// TODO(catalog): Product images, barcode scanner, supplier link, price history, and stock movement ledger.

import { useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { ProductDialog } from "@/features/catalog/components/products/product-dialog";
import { StockAdjustmentDialog } from "@/features/catalog/components/products/stock-adjustment-dialog";
import { useCatalogProduct } from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import { datetime } from "@/lib/utils/format";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useLocale } from "@/providers/locale-provider";

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
  const product = query.data;
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const title = product?.name ?? t("catalog.detail.product_title");

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
          <div className="flex items-center gap-2">
            {product.track_stock ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdjusting(true)}
              >
                {t("catalog.products.adjust_stock")}
              </Button>
            ) : null}
            <Button type="button" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
          </div>
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
                    : "success"
              }
            />
          </div>

          <EntitySectionCard title={t("catalog.detail.product_info")}>
            <EntityDetail
              sections={[
                {
                  id: "identity",
                  fields: [
                    {
                      key: "name",
                      label: t("catalog.products.name"),
                      value: product.name,
                    },
                    {
                      key: "category",
                      label: t("catalog.products.category"),
                      value: product.category_name || "—",
                    },
                    {
                      key: "sku",
                      label: t("catalog.products.sku"),
                      value: product.sku || "—",
                    },
                    {
                      key: "barcode",
                      label: t("catalog.products.barcode"),
                      value: product.barcode || "—",
                    },
                    {
                      key: "unit",
                      label: t("catalog.products.unit"),
                      value: catalogUnitLabel(t, product.unit),
                    },
                  ],
                },
                {
                  id: "pricing",
                  fields: [
                    {
                      key: "cost",
                      label: t("catalog.products.cost_price"),
                      value: formatFinanceAmount(
                        product.cost_price,
                        product.currency,
                        locale,
                      ),
                    },
                    {
                      key: "sale",
                      label: t("catalog.products.sale_price"),
                      value: formatFinanceAmount(
                        product.sale_price,
                        product.currency,
                        locale,
                      ),
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
                      key: "qty",
                      label: t("catalog.products.stock_quantity"),
                      value: `${product.stock_quantity} ${catalogUnitLabel(t, product.unit)}`,
                    },
                    {
                      key: "min",
                      label: t("catalog.products.min_stock_alert"),
                      value: `${product.min_stock_alert} ${catalogUnitLabel(t, product.unit)}`,
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
            {product.description ? (
              <p className="text-muted-foreground mt-4 text-sm">
                {product.description}
              </p>
            ) : null}
          </EntitySectionCard>
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
