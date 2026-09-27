"use client";

import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { EntityPage } from "@/components/entity/entity-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { permissions } from "@/config/permissions";
import { ORDER_TONE } from "@/features/billing/components/orders-history";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { CustomOrderDialog } from "@/features/platform-billing/components/custom-order-dialog";
import { PaymentDetailSheet } from "@/features/platform-billing/components/payment-detail-sheet";
import {
  usePlatformBillingAccess,
  usePlatformOrders,
  usePlatformOrdersSummary,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const TABS = [
  "payment_reported",
  "pending_payment",
  "approved",
  "rejected",
  "all",
] as const;
type Tab = (typeof TABS)[number];

export function PaymentsPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const [tab, setTab] = useState<Tab>("payment_reported");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const summary = usePlatformOrdersSummary(access.canRead);
  const orders = usePlatformOrders(
    {
      status: tab === "all" ? undefined : tab,
      q: q.trim() || undefined,
      limit: 50,
    },
    access.canRead,
  );
  const items = orders.data?.items ?? [];
  const count = (key: Tab) =>
    key === "payment_reported"
      ? summary.data?.payment_reported
      : key === "pending_payment"
        ? summary.data?.pending_payment
        : undefined;

  return (
    <EntityPage
      title={t("billing.payments.title")}
      description={t("billing.payments.description")}
      permission={permissions.platformBilling.read}
      actions={
        access.canWrite ? (
          <Button onClick={() => setCustomOpen(true)}>
            <Plus className="size-4" />
            {t("billing.custom_order.button")}
          </Button>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`billing.payments.tab.${key}`)}
                {count(key) ? (
                  <Badge
                    variant={
                      key === "payment_reported" ? "warning" : "secondary"
                    }
                    className="ml-1.5 px-1.5"
                  >
                    {count(key)}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("billing.payments.search")}
            className="pl-8"
          />
        </div>
      </div>
      {orders.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={t("billing.payments.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-normal">
                  {t("billing.payments.col.organization")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.payments.col.plan")}
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  {t("billing.payments.col.amount")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.payments.col.reference")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.payments.col.reported_at")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.payments.col.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((o) => (
                <tr
                  key={o.uuid}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelected(o.uuid)}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium">{o.organization?.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {o.organization?.slug}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {o.plan.name} · {t(`billing.period.${o.period}`)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatFinanceAmount(o.total, "TRY", locale)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {o.reference_code}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.reported_at
                      ? datetime(o.reported_at, "dd.MM.yyyy HH:mm", locale)
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip
                      label={t(`billing.order.status.${o.status}`)}
                      tone={ORDER_TONE[o.status]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CustomOrderDialog open={customOpen} onOpenChange={setCustomOpen} />
      <PaymentDetailSheet
        uuid={selected}
        canWrite={access.canWrite}
        onOpenChange={(v) => !v && setSelected(null)}
      />
    </EntityPage>
  );
}
