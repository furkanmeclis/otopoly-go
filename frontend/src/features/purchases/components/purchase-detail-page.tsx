"use client";

import { useCallback } from "react";
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
import {
  usePurchase,
  usePurchasesMutations,
} from "@/features/purchases/hooks/use-purchases";
import { useTenantPurchasesAccess } from "@/features/purchases/hooks/use-tenant-purchases-access";
import type { PurchaseStatus } from "@/features/purchases/services/purchases.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

function statusTone(status: PurchaseStatus) {
  switch (status) {
    case "posted":
      return "success" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function PurchaseDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useTenantPurchasesAccess(slug);
  const purchaseQuery = usePurchase(uuid);
  const mutations = usePurchasesMutations();
  const purchase = purchaseQuery.data;

  const handleVoid = useCallback(async () => {
    const confirmed = await confirm({
      title: t("purchases.void.title"),
      description: t("purchases.void.description"),
      confirmLabel: t("purchases.void.confirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    await mutations.voidPurchase.mutateAsync(uuid);
  }, [confirm, mutations.voidPurchase, t, uuid]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("purchases.forbidden")}
      />
    );
  }

  const title = purchase?.supplier_name ?? t("purchases.detail.title");

  return (
    <EntityPage
      title={title}
      description={t("purchases.detail.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("purchases.title"),
          href: routes.tenant.purchases.root(slug),
        },
        { label: title },
      ]}
      actions={
        purchase && canWrite && purchase.status === "posted" ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={mutations.voidPurchase.isPending}
              onClick={() => void handleVoid()}
            >
              <Ban className="size-4" />
              {t("purchases.actions.void")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {purchaseQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {purchaseQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("purchases.detail.error")}
          onRetry={() => void purchaseQuery.refetch()}
        />
      ) : null}

      {purchase ? (
        <div className="space-y-6">
          <EntityHeader
            title={purchase.supplier_name}
            badges={
              <StatusChip
                label={t(`purchases.status.${purchase.status}`)}
                tone={statusTone(purchase.status)}
              />
            }
          >
            <p className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(
                purchase.total_amount,
                purchase.currency,
                locale,
              )}
            </p>
          </EntityHeader>

          <EntitySectionCard title={t("purchases.detail.info")}>
            <EntityDetail
              sections={[
                {
                  id: "info",
                  fields: [
                    {
                      key: "supplier",
                      label: t("purchases.supplier"),
                      value: purchase.supplier_name,
                    },
                    {
                      key: "method",
                      label: t("purchases.method"),
                      value: t(`purchases.payment_method.${purchase.method}`),
                    },
                    {
                      key: "finance",
                      label: t("purchases.finance_account"),
                      value: purchase.finance_account_name || "—",
                    },
                    {
                      key: "purchased_at",
                      label: t("purchases.purchased_at"),
                      value: datetime(
                        purchase.purchased_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                    {
                      key: "voided_at",
                      label: t("purchases.voided_at"),
                      value: purchase.voided_at
                        ? datetime(
                            purchase.voided_at,
                            "dd.MM.yyyy HH:mm",
                            locale,
                          )
                        : "—",
                    },
                    {
                      key: "notes",
                      label: t("purchases.notes"),
                      value: purchase.notes || "—",
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <EntitySectionCard
            title={t("purchases.detail.lines")}
            badge={purchase.lines?.length ?? 0}
          >
            {(purchase.lines?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("purchases.detail.lines_empty")}
              </p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {purchase.lines.map((line) => (
                  <li
                    key={line.uuid}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{line.name}</p>
                      <p className="text-muted-foreground tabular-nums">
                        {formatFinanceAmount(
                          line.unit_cost,
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
