"use client";

import { Check, CreditCard, X } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { EntityPage } from "@/components/entity/entity-page";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { permissions } from "@/config/permissions";
import { UsageMeter } from "@/features/billing/components/usage-meter";
import {
  useBillingAccess,
  useBillingOverview,
  useBillingPlans,
} from "@/features/billing/hooks/use-billing";
import { meterLabel } from "@/features/billing/lib";
import type {
  BillingOverview,
  BillingPlan,
  BillingPlanFeatureValue,
  BillingSubscription,
  BillingUsageMeter,
  SubscriptionPeriod,
} from "@/features/billing/types";
import { formatFinanceAmount, formatQuantity } from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUS_TONE: Record<BillingSubscription["status"], "default" | "success" | "warning" | "danger"> = {
  trial: "default",
  active: "success",
  grace: "warning",
  read_only: "danger",
  cancelled: "danger",
};

export function SubscriptionPage() {
  const { t } = useLocale();
  const access = useBillingAccess();
  const overview = useBillingOverview(access.canRead);
  const plans = useBillingPlans(access.canRead);
  const [period, setPeriod] = useState<SubscriptionPeriod>("monthly");

  return (
    <EntityPage
      title={t("billing.title")}
      description={t("billing.description")}
      permission={permissions.billing.read}
      forbiddenFallback={<EmptyState title={t("billing.forbidden")} />}
    >
      {overview.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : overview.data ? (
        <div className="space-y-6">
          <PlanCard overview={overview.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <UsageCard meters={overview.data.meters} />
            <FeaturesCard meters={overview.data.meters} plan={overview.data.plan ?? null} />
          </div>
          <EntitySectionCard
            title={t("billing.plans.title")}
            action={
              <Tabs value={period} onValueChange={(v) => setPeriod(v as SubscriptionPeriod)}>
                <TabsList>
                  <TabsTrigger value="monthly">{t("billing.period.monthly")}</TabsTrigger>
                  <TabsTrigger value="yearly">{t("billing.period.yearly")}</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            <p className="text-muted-foreground mb-4 text-sm">{t("billing.plans.description")}</p>
            {plans.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : plans.data && plans.data.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.data.map((plan) => (
                  <PlanOffer
                    key={plan.uuid}
                    plan={plan}
                    period={period}
                    current={overview.data?.subscription?.plan_code === plan.code}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title={t("billing.plans.empty")} />
            )}
          </EntitySectionCard>
        </div>
      ) : (
        <EmptyState title={t("billing.no_subscription")} />
      )}
    </EntityPage>
  );
}

function PlanCard({ overview }: { overview: BillingOverview }) {
  const { t, locale } = useLocale();
  const sub = overview.subscription;
  if (!sub) return <EmptyState title={t("billing.no_subscription")} />;
  const expired = sub.days_left <= 0;
  return (
    <EntitySectionCard title={t("billing.current_plan")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CreditCard className="text-muted-foreground size-5" />
            <span className="text-xl font-semibold">{sub.plan_name}</span>
            <StatusChip label={t(`billing.status.${sub.status}`)} tone={STATUS_TONE[sub.status]} />
          </div>
          {overview.plan?.description ? (
            <p className="text-muted-foreground text-sm">{overview.plan.description}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <dt className="text-muted-foreground">{t("billing.period." + sub.period)}</dt>
          <dd className="col-span-1 sm:col-span-2">
            {t("billing.starts_at")}: {date(sub.starts_at, "dd.MM.yyyy", locale)}
          </dd>
          <dt className="text-muted-foreground">{t("billing.ends_at")}</dt>
          <dd className={cn("col-span-1 sm:col-span-2", expired && "text-rose-600 dark:text-rose-400")}>
            {date(sub.ends_at, "dd.MM.yyyy", locale)} ·{" "}
            {expired ? t("billing.expired") : t("billing.days_left", { days: sub.days_left })}
          </dd>
        </dl>
      </div>
    </EntitySectionCard>
  );
}

function UsageCard({ meters }: { meters: BillingUsageMeter[] }) {
  const { t } = useLocale();
  const limits = meters.filter((m) => m.kind === "limit");
  return (
    <EntitySectionCard title={t("billing.usage.title")}>
      {limits.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("billing.usage.empty")}</p>
      ) : (
        <div className="space-y-4">
          {limits.map((m) => (
            <UsageMeter key={m.key} meter={m} />
          ))}
        </div>
      )}
    </EntitySectionCard>
  );
}

function FeaturesCard({ meters, plan }: { meters: BillingUsageMeter[]; plan: BillingPlan | null }) {
  const { t, locale } = useLocale();
  const toggles = meters.filter((m) => m.kind === "toggle");
  const displays = plan?.features.filter((f) => f.display_text) ?? [];
  return (
    <EntitySectionCard title={t("billing.features.title")}>
      <ul className="space-y-2 text-sm">
        {toggles.map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-3">
            <span>{meterLabel(m, locale)}</span>
            <FeatureState on={m.enabled !== false} />
          </li>
        ))}
        {displays.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-3">
            <span>{f.display_text}</span>
            <Check className="size-4 text-emerald-600" />
          </li>
        ))}
      </ul>
    </EntitySectionCard>
  );
}

function FeatureState({ on }: { on: boolean }) {
  const { t } = useLocale();
  return on ? (
    <Badge variant="success">
      <Check className="size-3" /> {t("billing.features.on")}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <X className="size-3" /> {t("billing.features.off")}
    </Badge>
  );
}

function PlanOffer({
  plan,
  period,
  current,
}: {
  plan: BillingPlan;
  period: SubscriptionPeriod;
  current: boolean;
}) {
  const { t, locale } = useLocale();
  const price = period === "monthly" ? plan.price_monthly : plan.effective_yearly;
  const saving =
    period === "yearly" && plan.yearly_pricing !== "fixed"
      ? plan.yearly_pricing === "discount_percent"
        ? `%${formatQuantity(plan.yearly_discount_value, locale)}`
        : formatFinanceAmount(plan.yearly_discount_value, plan.currency, locale)
      : null;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        current && "border-primary ring-primary/20 ring-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{plan.name}</p>
          {plan.description ? (
            <p className="text-muted-foreground text-xs">{plan.description}</p>
          ) : null}
        </div>
        {plan.badge ? <Badge variant="secondary">{plan.badge}</Badge> : null}
      </div>
      <div>
        <span className="text-2xl font-semibold tabular-nums">
          {formatFinanceAmount(price, plan.currency, locale)}
        </span>
        <span className="text-muted-foreground text-sm">
          {" "}
          {period === "monthly" ? t("billing.plans.per_month") : t("billing.plans.per_year")}
        </span>
        <p className="text-muted-foreground text-[11px]">{t("billing.plans.vat_included")}</p>
        {saving ? (
          <Badge variant="success" className="mt-1">
            {t("billing.plans.yearly_saving", { value: saving })}
          </Badge>
        ) : null}
      </div>
      <ul className="text-muted-foreground flex-1 space-y-1 text-xs">
        {plan.features.map((f) => (
          <li key={f.key}>{featureLine(f)}</li>
        ))}
      </ul>
      <Button variant={current ? "secondary" : "default"} disabled>
        {current ? t("billing.plans.current") : t("billing.plans.coming_soon")}
      </Button>
    </div>
  );
}

function featureLine(f: BillingPlanFeatureValue) {
  if (f.display_text) return f.display_text;
  if (f.value_bool !== null && f.value_bool !== undefined) return `${f.key}: ${f.value_bool ? "✓" : "—"}`;
  if (f.value_int !== null && f.value_int !== undefined) return `${f.key}: ${f.value_int}`;
  return f.key;
}
