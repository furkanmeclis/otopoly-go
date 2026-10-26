"use client";

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
import { Progress } from "@/components/ui/progress";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { UsageTable } from "@/features/loyalty/components/usage-table";
import {
  useCustomerPackage,
  useLoyaltyAccess,
  useLoyaltyMutations,
} from "@/features/loyalty/hooks/use-loyalty";
import { packageStateTone } from "@/features/loyalty/lib/labels";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { date, datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function CustomerPackageDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useLoyaltyAccess();
  const query = useCustomerPackage(uuid);
  useTenantLiveRefetch(TenantLiveResources.loyaltyPackages, query.refetch, {
    uuid,
  });
  const { cancelCustomerPackage } = useLoyaltyMutations();
  const p = query.data;

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("loyalty.forbidden")}
      />
    );
  }
  const title = p?.name ?? t("loyalty.sold.detail");

  return (
    <EntityPage
      title={title}
      description={t("loyalty.sold.detail_description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("loyalty.title"),
          href: routes.tenant.loyalty.tab(slug, "sold"),
        },
        { label: title },
      ]}
      actions={
        p && canWrite && p.state !== "cancelled" ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cancelCustomerPackage.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("loyalty.sold.cancel_title"),
                  description: t(
                    p.credits_used > 0
                      ? "loyalty.sold.cancel_used"
                      : "loyalty.sold.cancel_refund",
                  ),
                  confirmLabel: t("loyalty.sold.cancel_confirm"),
                  variant: "destructive",
                });
                if (ok) await cancelCustomerPackage.mutateAsync(uuid);
              }}
            >
              <Ban className="size-4" />
              {t("loyalty.sold.cancel")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("loyalty.errors.detail")}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {p ? (
        <div className="space-y-6">
          <EntityHeader
            title={p.name}
            subtitle={
              <Link
                href={routes.tenant.customers.detail(slug, p.customer_uuid)}
                className="text-primary hover:underline"
              >
                {p.customer_name}
              </Link>
            }
            badges={
              <StatusChip
                label={t(`loyalty.package_state.${p.state}`)}
                tone={packageStateTone(p.state)}
              />
            }
          >
            <p className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(p.price, p.currency, locale)}
            </p>
          </EntityHeader>

          <div className="grid gap-6 lg:grid-cols-2">
            <EntitySectionCard title={t("loyalty.fields.credits")}>
              <ul className="space-y-3 text-sm">
                {p.credits.map((c) => (
                  <li key={c.service_uuid} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{c.service_name}</span>
                      <span className="tabular-nums">
                        {t("loyalty.packages.credits_left", {
                          left: c.remaining,
                          total: c.total,
                        })}
                      </span>
                    </div>
                    <Progress
                      value={c.total ? (c.remaining / c.total) * 100 : 0}
                    />
                  </li>
                ))}
              </ul>
            </EntitySectionCard>
            <EntitySectionCard title={t("loyalty.sold.info")}>
              <EntityDetail
                sections={[
                  {
                    id: "info",
                    fields: [
                      {
                        key: "purchased",
                        label: t("loyalty.fields.purchased_at"),
                        value: datetime(
                          p.purchased_at,
                          "dd.MM.yyyy HH:mm",
                          locale,
                        ),
                      },
                      {
                        key: "expires",
                        label: t("loyalty.fields.expires_at"),
                        value: p.expires_at
                          ? date(p.expires_at, "dd.MM.yyyy", locale)
                          : t("loyalty.packages.no_expiry"),
                      },
                      {
                        key: "method",
                        label: t("loyalty.fields.method"),
                        value: t(`loyalty.method.${p.payment_method}`),
                      },
                      {
                        key: "cancelled",
                        label: t("loyalty.fields.cancelled_at"),
                        value: p.cancelled_at
                          ? datetime(p.cancelled_at, "dd.MM.yyyy HH:mm", locale)
                          : "—",
                      },
                      {
                        key: "notes",
                        label: t("loyalty.fields.notes"),
                        value: p.notes || "—",
                      },
                    ],
                  },
                ]}
              />
            </EntitySectionCard>
          </div>

          <EntitySectionCard
            title={t("loyalty.usage.title")}
            badge={p.usage.length}
          >
            <UsageTable slug={slug} rows={p.usage} currency={p.currency} />
          </EntitySectionCard>
        </div>
      ) : null}
    </EntityPage>
  );
}
