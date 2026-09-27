"use client";

import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EntityPage } from "@/components/entity/entity-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import type { BillingPlan } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { FeaturesDialog } from "@/features/platform-billing/components/features-dialog";
import { PlanDialog } from "@/features/platform-billing/components/plan-dialog";
import {
  usePlatformBillingAccess,
  usePlatformPlanMutations,
  usePlatformPlans,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

export function PlansPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const plans = usePlatformPlans(access.canRead);
  const { remove } = usePlatformPlanMutations();
  const [editing, setEditing] = useState<BillingPlan | null | undefined>(undefined);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [deleting, setDeleting] = useState<BillingPlan | null>(null);

  return (
    <EntityPage
      title={t("billing.admin.plans")}
      description={t("billing.admin.plans_description")}
      permission={permissions.platformBilling.read}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFeaturesOpen(true)}>
            <Sparkles className="size-4" />
            {t("billing.admin.features")}
          </Button>
          {access.canWrite ? (
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" />
              {t("billing.admin.plan.new")}
            </Button>
          ) : null}
        </div>
      }
    >
      {plans.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : plans.data && plans.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((plan) => {
            const blocked = plan.code === "trial" || plan.live_subscriptions > 0;
            return (
              <div key={plan.uuid} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{plan.name}</p>
                    <p className="text-muted-foreground text-xs">{plan.code}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {plan.badge ? <Badge variant="secondary">{plan.badge}</Badge> : null}
                    {!plan.is_active ? <Badge variant="danger">{t("billing.admin.plan.inactive")}</Badge> : null}
                    <Badge variant="outline">
                      {plan.is_public ? t("billing.admin.plan.public") : t("billing.admin.plan.private")}
                    </Badge>
                    {plan.is_customizable ? <Badge variant="warning">{t("billing.admin.plan.customizable")}</Badge> : null}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-xl font-semibold tabular-nums">
                    {formatFinanceAmount(plan.price_monthly, plan.currency, locale)}
                  </span>
                  <span className="text-muted-foreground"> {t("billing.plans.per_month")}</span>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatFinanceAmount(plan.effective_yearly, plan.currency, locale)} {t("billing.plans.per_year")}
                    {plan.trial_days > 0 ? ` · ${t("billing.plans.trial_days", { days: plan.trial_days })}` : ""}
                  </p>
                </div>
                <ul className="text-muted-foreground flex-1 space-y-0.5 text-xs">
                  {plan.features.slice(0, 4).map((f) => (
                    <li key={f.key}>
                      {f.key}:{" "}
                      {f.display_text ||
                        (f.value_bool !== null && f.value_bool !== undefined
                          ? f.value_bool ? "✓" : "—"
                          : (f.value_int ?? "∞"))}
                      {f.enforcement === "soft" ? ` (${t("billing.admin.plan.feature.soft").toLowerCase()})` : ""}
                      {f.tolerance_pct ? ` +${f.tolerance_pct}%` : ""}
                    </li>
                  ))}
                  {plan.features.length > 4 ? (
                    <li>{t("billing.admin.plan.more_features", { count: plan.features.length - 4 })}</li>
                  ) : null}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">
                    {t("billing.admin.plan.live", { count: plan.live_subscriptions })}
                  </span>
                  {access.canWrite ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(plan)}>
                        <Pencil className="size-3.5" />
                        {t("billing.admin.plan.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={blocked}
                        title={blocked ? t("billing.admin.plan.delete_blocked") : undefined}
                        onClick={() => setDeleting(plan)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title={t("billing.admin.empty")} />
      )}

      <PlanDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        plan={editing ?? null}
      />
      <FeaturesDialog open={featuresOpen} onOpenChange={setFeaturesOpen} canWrite={access.canWrite} />
      <ConfirmDialog
        open={deleting !== null}
        title={t("billing.admin.plan.delete")}
        description={t("billing.admin.plan.delete_confirm")}
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
