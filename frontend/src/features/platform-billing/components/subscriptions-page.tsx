"use client";

import { Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { EntityPage } from "@/components/entity/entity-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import type {
  AdminSubscription,
  SubscriptionStatus,
} from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { SubscriptionDialog } from "@/features/platform-billing/components/subscription-dialog";
import {
  usePlatformBillingAccess,
  usePlatformSubscriptions,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { cn } from "@/lib/utils";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUSES: SubscriptionStatus[] = [
  "trial",
  "active",
  "grace",
  "read_only",
  "cancelled",
];
const TONE: Record<
  SubscriptionStatus,
  "default" | "success" | "warning" | "danger"
> = {
  trial: "default",
  active: "success",
  grace: "warning",
  read_only: "danger",
  cancelled: "default",
};
const ALL = "__all__";

export function SubscriptionsPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const [status, setStatus] = useState(ALL);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{
    open: boolean;
    sub: AdminSubscription | null;
  }>({
    open: false,
    sub: null,
  });
  const list = usePlatformSubscriptions(
    {
      status: status === ALL ? undefined : status,
      q: q.trim() || undefined,
      limit: 100,
    },
    access.canRead,
  );
  const items = list.data?.items ?? [];

  return (
    <EntityPage
      title={t("billing.subs.title")}
      description={t("billing.subs.description")}
      permission={permissions.platformBilling.read}
      actions={
        access.canWrite ? (
          <Button onClick={() => setDialog({ open: true, sub: null })}>
            <Plus className="size-4" />
            {t("billing.subs.new")}
          </Button>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("billing.subs.search")}
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("billing.subs.filter_all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`billing.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={t("billing.subs.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.organization")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.plan")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.status")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.ends_at")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.days_left")}
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  {t("billing.subs.col.price_paid")}
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  {t("billing.subs.col.credit")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.subs.col.source")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((s) => (
                <tr key={s.uuid}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{s.organization.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {s.organization.slug}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {s.plan.name} · {t(`billing.period.${s.period}`)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip
                      label={t(`billing.status.${s.status}`)}
                      tone={TONE[s.status]}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {date(s.ends_at, "dd.MM.yyyy", locale)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 whitespace-nowrap tabular-nums",
                      s.status !== "cancelled" &&
                        s.days_left <= 0 &&
                        "text-rose-600 dark:text-rose-400",
                      s.status !== "cancelled" &&
                        s.days_left > 0 &&
                        s.days_left <= 7 &&
                        "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {s.status === "cancelled"
                      ? "—"
                      : t("billing.subs.days", { days: s.days_left })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatFinanceAmount(s.price_paid, "TRY", locale)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatFinanceAmount(s.credit_balance, "TRY", locale)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t(`billing.source.${s.source}`)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {access.canWrite && s.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ open: true, sub: s })}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">
                          {t("billing.subs.edit")}
                        </span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SubscriptionDialog
        open={dialog.open}
        subscription={dialog.sub}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </EntityPage>
  );
}
