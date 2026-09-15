"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Ban } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useSale, useSalesMutations } from "@/features/sales/hooks/use-sales";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import type { SaleStatus } from "@/features/sales/services/sales.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

function statusTone(status: SaleStatus) {
  switch (status) {
    case "posted":
      return "success" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function SaleDetailPage({ slug, uuid }: { slug: string; uuid: string }) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useTenantSalesAccess(slug);
  const saleQuery = useSale(uuid);
  const mutations = useSalesMutations();
  const sale = saleQuery.data;

  const handleVoid = useCallback(async () => {
    const confirmed = await confirm({
      title: t("sales.void.title"),
      description: t("sales.void.description"),
      confirmLabel: t("sales.void.confirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    await mutations.voidSale.mutateAsync(uuid);
  }, [confirm, mutations.voidSale, t, uuid]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("sales.forbidden")}
      />
    );
  }

  const title =
    sale?.customer_name ||
    (sale ? t("sales.walk_in") : t("sales.detail.title"));

  return (
    <EntityPage
      title={title}
      description={t("sales.detail.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("sales.title"), href: routes.tenant.sales.root(slug) },
        { label: title },
      ]}
      actions={
        sale && canWrite && sale.status === "posted" ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={mutations.voidSale.isPending}
              onClick={() => void handleVoid()}
            >
              <Ban className="size-4" />
              {t("sales.actions.void")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {saleQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {saleQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("sales.detail.error")}
          onRetry={() => void saleQuery.refetch()}
        />
      ) : null}

      {sale ? (
        <div className="space-y-6">
          <EntityHeader
            title={sale.customer_name || t("sales.walk_in")}
            subtitle={sale.customer_phone || undefined}
            badges={
              <StatusChip
                label={t(`sales.status.${sale.status}`)}
                tone={statusTone(sale.status)}
              />
            }
          >
            <p className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(sale.total_amount, sale.currency, locale)}
            </p>
          </EntityHeader>

          <EntitySectionCard title={t("sales.detail.info")}>
            <EntityDetail
              sections={[
                {
                  id: "info",
                  fields: [
                    {
                      key: "customer",
                      label: t("sales.customer"),
                      value: sale.customer_uuid ? (
                        <Link
                          href={routes.tenant.customers.detail(
                            slug,
                            sale.customer_uuid,
                          )}
                          className="text-primary hover:underline"
                        >
                          {sale.customer_name}
                        </Link>
                      ) : (
                        t("sales.walk_in")
                      ),
                    },
                    {
                      key: "method",
                      label: t("sales.method"),
                      value: t(`sales.payment_method.${sale.method}`),
                    },
                    {
                      key: "finance",
                      label: t("sales.finance_account"),
                      value: sale.finance_account_name || "—",
                    },
                    {
                      key: "sold_at",
                      label: t("sales.sold_at"),
                      value: datetime(sale.sold_at, "dd.MM.yyyy HH:mm", locale),
                    },
                    {
                      key: "voided_at",
                      label: t("sales.voided_at"),
                      value: sale.voided_at
                        ? datetime(sale.voided_at, "dd.MM.yyyy HH:mm", locale)
                        : "—",
                    },
                    {
                      key: "notes",
                      label: t("sales.notes"),
                      value: sale.notes || "—",
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <EntitySectionCard
            title={t("sales.detail.lines")}
            badge={sale.lines?.length ?? 0}
          >
            {(sale.lines?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("sales.detail.lines_empty")}
              </p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {sale.lines.map((line) => (
                  <li
                    key={line.uuid}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{line.name}</p>
                      <p className="text-muted-foreground tabular-nums">
                        {formatFinanceAmount(
                          line.unit_price,
                          line.currency,
                          locale,
                        )}{" "}
                        × {line.qty}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatFinanceAmount(
                        line.line_total,
                        line.currency,
                        locale,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </EntitySectionCard>
        </div>
      ) : null}
    </EntityPage>
  );
}
