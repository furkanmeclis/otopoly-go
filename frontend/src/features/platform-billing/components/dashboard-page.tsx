"use client";

import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { StatsCard } from "@/components/common/stats-card";
import { StatusChip } from "@/components/common/status-chip";
import { EntityPage } from "@/components/entity/entity-page";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import {
  useBillingDashboard,
  usePlatformBillingAccess,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

const STATUS_ORDER = ["active", "trial", "grace", "read_only"] as const;
const STATUS_TONE = {
  active: "success",
  trial: "default",
  grace: "warning",
  read_only: "danger",
} as const;

export function BillingDashboardPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const dash = useBillingDashboard(access.canRead);
  const d = dash.data;
  const maxPlan = Math.max(1, ...(d?.plans.map((p) => p.count) ?? [1]));

  return (
    <EntityPage
      title={t("billing.dash.title")}
      description={t("billing.dash.description")}
      permission={permissions.platformBilling.read}
    >
      {!d ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatsCard
              title={t("billing.dash.approved_month")}
              value={formatFinanceAmount(
                d.approved_this_month.amount,
                "TRY",
                locale,
              )}
              hint={t("billing.dash.approved_count", {
                count: d.approved_this_month.count,
              })}
            />
            <Link href={routes.platform.billing.payments} className="block">
              <StatsCard
                title={t("billing.dash.pending")}
                value={formatQuantity(
                  d.orders.payment_reported + d.orders.pending_payment,
                  locale,
                )}
                hint={t("billing.dash.pending_hint", {
                  reported: d.orders.payment_reported,
                  pending: d.orders.pending_payment,
                })}
              />
            </Link>
            <Link
              href={`${routes.platform.billing.subscriptions}?expiring=7`}
              className="block"
            >
              <StatsCard
                title={`${t("billing.dash.expiring")} · ${t("billing.dash.expiring_7")}`}
                value={formatQuantity(d.expiring.within_7, locale)}
                hint={t("billing.dash.expiring_hint", {
                  count: d.expiring.within_30,
                })}
              />
            </Link>
            <StatsCard
              title={t("billing.dash.conversion")}
              value={`%${formatQuantity(d.trial_conversion.rate, locale)}`}
              hint={t("billing.dash.conversion_hint", {
                converted: d.trial_conversion.converted_90d,
                trials: d.trial_conversion.trials_90d,
              })}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <EntitySectionCard title={t("billing.dash.status")}>
              <ul className="grid grid-cols-2 gap-3">
                {STATUS_ORDER.map((s) => (
                  <li
                    key={s}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <StatusChip
                      label={t(`billing.status.${s}`)}
                      tone={STATUS_TONE[s]}
                    />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatQuantity(d.counts[s], locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </EntitySectionCard>

            <EntitySectionCard title={t("billing.dash.plans")}>
              {d.plans.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("billing.dash.plans_empty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {d.plans.map((p) => (
                    <li key={p.code} title={`${p.name}: ${p.count}`}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{p.name}</span>
                        <span className="tabular-nums">
                          {formatQuantity(p.count, locale)}
                        </span>
                      </div>
                      <div className="bg-muted h-2 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (p.count / maxPlan) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </EntitySectionCard>
          </div>

          <EntitySectionCard title={t("billing.dash.discounts")}>
            {d.discounts.length === 0 ? (
              <EmptyState title={t("billing.dash.discounts_empty")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="py-2 pr-3 font-normal">
                        {t("billing.dash.col.code")}
                      </th>
                      <th className="py-2 pr-3 text-right font-normal">
                        {t("billing.dash.col.uses")}
                      </th>
                      <th className="py-2 pr-3 text-right font-normal">
                        {t("billing.dash.col.discount")}
                      </th>
                      <th className="py-2 text-right font-normal">
                        {t("billing.dash.col.revenue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.discounts.map((c) => (
                      <tr key={c.code}>
                        <td className="py-2 pr-3 font-mono">{c.code}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {c.uses}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatFinanceAmount(c.discount_total, "TRY", locale)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatFinanceAmount(c.revenue, "TRY", locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EntitySectionCard>
        </div>
      )}
    </EntityPage>
  );
}
