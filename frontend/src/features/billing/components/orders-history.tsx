"use client";

import { StatusChip } from "@/components/common/status-chip";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { useBillingOrders } from "@/features/billing/hooks/use-billing";
import type { OrderStatus } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export const ORDER_TONE: Record<
  OrderStatus,
  "default" | "success" | "warning" | "danger"
> = {
  pending_payment: "warning",
  payment_reported: "default",
  approved: "success",
  rejected: "danger",
  cancelled: "default",
  expired: "default",
};

export function OrdersHistory() {
  const { t, locale } = useLocale();
  const orders = useBillingOrders("all");
  const items = orders.data?.items ?? [];
  return (
    <EntitySectionCard title={t("billing.order.history")}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("billing.order.history_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-2 pr-3 font-normal">
                  {t("billing.order.date")}
                </th>
                <th className="py-2 pr-3 font-normal">
                  {t("billing.order.plan")}
                </th>
                <th className="py-2 pr-3 font-normal">
                  {t("billing.order.reference")}
                </th>
                <th className="py-2 pr-3 text-right font-normal">
                  {t("billing.order.amount")}
                </th>
                <th className="py-2 font-normal">
                  {t("billing.order.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((o) => (
                <tr key={o.uuid}>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {date(o.created_at, "dd.MM.yyyy", locale)}
                  </td>
                  <td className="py-2 pr-3">
                    {o.plan.name} · {t(`billing.period.${o.period}`)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {o.reference_code}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatFinanceAmount(o.total, "TRY", locale)}
                  </td>
                  <td className="py-2">
                    <span
                      title={
                        o.reject_reason
                          ? t("billing.order.reject_reason", {
                              reason: o.reject_reason,
                            })
                          : undefined
                      }
                    >
                      <StatusChip
                        label={t(`billing.order.status.${o.status}`)}
                        tone={ORDER_TONE[o.status]}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EntitySectionCard>
  );
}
