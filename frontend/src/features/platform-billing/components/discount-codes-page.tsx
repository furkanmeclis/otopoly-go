"use client";

import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EntityPage } from "@/components/entity/entity-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import type { DiscountCode } from "@/features/billing/types";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { DiscountCodeDialog } from "@/features/platform-billing/components/discount-code-dialog";
import {
  usePlatformBillingAccess,
  usePlatformDiscountCodes,
  usePlatformDiscountMutations,
  usePlatformPlans,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function DiscountCodesPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{
    open: boolean;
    code: DiscountCode | null;
  }>({ open: false, code: null });
  const [deleting, setDeleting] = useState<DiscountCode | null>(null);
  const list = usePlatformDiscountCodes(
    { q: q.trim() || undefined, limit: 100 },
    access.canRead,
  );
  const plans = usePlatformPlans(access.canRead);
  const { remove } = usePlatformDiscountMutations();
  const planName = (uuid: string) =>
    plans.data?.find((p) => p.uuid === uuid)?.name ?? "?";
  const items = list.data?.items ?? [];

  const scope = (c: DiscountCode) => {
    const p = c.plan_uuids.length
      ? c.plan_uuids.map(planName).join(", ")
      : t("billing.discounts.all_plans");
    const per = c.periods.length
      ? c.periods.map((x) => t(`billing.period.${x}`)).join(", ")
      : t("billing.discounts.all_periods");
    return `${p} · ${per}`;
  };
  const validity = (c: DiscountCode) => {
    if (!c.starts_at && !c.ends_at) return t("billing.discounts.no_limit");
    const s = c.starts_at ? date(c.starts_at, "dd.MM.yyyy", locale) : "…";
    const e = c.ends_at ? date(c.ends_at, "dd.MM.yyyy", locale) : "…";
    return `${s} – ${e}`;
  };

  return (
    <EntityPage
      title={t("billing.discounts.title")}
      description={t("billing.discounts.description")}
      permission={permissions.platformBilling.read}
      actions={
        access.canWrite ? (
          <Button onClick={() => setDialog({ open: true, code: null })}>
            <Plus className="size-4" />
            {t("billing.discounts.new")}
          </Button>
        ) : null
      }
    >
      <div className="relative mb-4 w-full sm:w-72">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("billing.discounts.search")}
          className="pl-8"
        />
      </div>
      {list.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={t("billing.discounts.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.code")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.value")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.scope")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.validity")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.usage")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.discounts.col.status")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.uuid}>
                  <td className="px-3 py-2">
                    <span className="font-mono font-medium">{c.code}</span>
                    {c.first_purchase_only ? (
                      <Badge variant="secondary" className="ml-2">
                        {t("billing.discounts.first_only_badge")}
                      </Badge>
                    ) : null}
                    {c.note ? (
                      <p className="text-muted-foreground text-xs">{c.note}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.kind === "percent"
                      ? `%${formatQuantity(c.value, locale)}`
                      : formatFinanceAmount(c.value, "TRY", locale)}
                  </td>
                  <td className="px-3 py-2 text-xs">{scope(c)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {validity(c)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.used_count} / {c.max_uses ?? "∞"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip
                      label={
                        c.is_active
                          ? t("billing.admin.plan.is_active")
                          : t("billing.admin.plan.inactive")
                      }
                      tone={c.is_active ? "success" : "default"}
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {access.canWrite ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDialog({ open: true, code: c })}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">
                            {t("billing.discounts.edit")}
                          </span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">
                            {t("billing.discounts.delete")}
                          </span>
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DiscountCodeDialog
        open={dialog.open}
        code={dialog.code}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t("billing.discounts.delete")}
        description={t("billing.discounts.delete_confirm")}
        variant="destructive"
        isPending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.uuid);
          } catch {
            /* toast via global handler */
          }
          setDeleting(null);
        }}
      />
    </EntityPage>
  );
}
