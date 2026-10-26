"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Wallet } from "lucide-react";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PaySubscriptionDialog } from "@/features/loyalty/components/pay-subscription-dialog";
import {
  PaymentsTable,
  UsageTable,
} from "@/features/loyalty/components/usage-table";
import {
  useLoyaltyAccess,
  useLoyaltyMutations,
  useSubscription,
} from "@/features/loyalty/hooks/use-loyalty";
import {
  renewalLabel,
  subscriptionStateTone,
} from "@/features/loyalty/lib/labels";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { date, datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function SubscriptionDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canApply, canWrite } = useLoyaltyAccess();
  const query = useSubscription(uuid);
  useTenantLiveRefetch(
    TenantLiveResources.loyaltySubscriptions,
    query.refetch,
    { uuid },
  );
  const { cancelSubscription } = useLoyaltyMutations();
  const [payOpen, setPayOpen] = useState(false);
  const s = query.data;

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("loyalty.forbidden")}
      />
    );
  }
  const title = s?.name ?? t("loyalty.subscriptions.detail");
  const period = s?.current_period;

  return (
    <EntityPage
      title={title}
      description={t("loyalty.subscriptions.detail_description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("loyalty.title"),
          href: routes.tenant.loyalty.tab(slug, "subscriptions"),
        },
        { label: title },
      ]}
      actions={
        s && s.state !== "cancelled" ? (
          <EntityActions>
            {canApply ? (
              <Button type="button" size="sm" onClick={() => setPayOpen(true)}>
                <Wallet className="size-4" />
                {t("loyalty.pay.title")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={cancelSubscription.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("loyalty.subscriptions.cancel_title"),
                    description: t("loyalty.subscriptions.cancel_description"),
                    confirmLabel: t("loyalty.subscriptions.cancel_confirm"),
                    variant: "destructive",
                  });
                  if (ok) await cancelSubscription.mutateAsync(uuid);
                }}
              >
                <Ban className="size-4" />
                {t("loyalty.subscriptions.cancel")}
              </Button>
            ) : null}
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
      {s ? (
        <div className="space-y-6">
          <EntityHeader
            title={s.name}
            subtitle={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Link
                  href={routes.tenant.customers.detail(slug, s.customer_uuid)}
                  className="text-primary hover:underline"
                >
                  {s.customer_name}
                </Link>
                {s.plate ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{s.plate}</span>
                  </>
                ) : null}
              </span>
            }
            badges={
              <StatusChip
                label={t(`loyalty.subscription_state.${s.state}`)}
                tone={subscriptionStateTone(s.state)}
              />
            }
          >
            <p className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(s.price, s.currency, locale)}
              <span className="text-muted-foreground ms-1 text-sm font-normal">
                / {t("loyalty.period.months", { count: s.period_months })}
              </span>
            </p>
          </EntityHeader>

          {s.state === "past_due" ? (
            <Alert>
              <AlertDescription>
                {t("loyalty.subscriptions.past_due_hint", {
                  date: date(s.renewal_date, "dd.MM.yyyy", locale),
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <EntitySectionCard title={t("loyalty.fields.this_period")}>
              {period ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    {date(period.start, "dd.MM.yyyy", locale)} –{" "}
                    {date(
                      new Date(
                        new Date(`${period.end}T00:00:00`).getTime() - 86400000,
                      ),
                      "dd.MM.yyyy",
                      locale,
                    )}
                  </p>
                  <p className="font-medium">
                    {period.limit
                      ? t("loyalty.subscriptions.used_of", {
                          used: period.used,
                          limit: period.limit,
                        })
                      : t("loyalty.subscriptions.used_unlimited", {
                          used: period.used,
                        })}
                  </p>
                  {period.limit ? (
                    <Progress value={(period.used / period.limit) * 100} />
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("loyalty.subscriptions.no_period")}
                </p>
              )}
            </EntitySectionCard>
            <EntitySectionCard title={t("loyalty.subscriptions.info")}>
              <EntityDetail
                sections={[
                  {
                    id: "info",
                    fields: [
                      {
                        key: "start",
                        label: t("loyalty.fields.start_date"),
                        value: date(s.start_date, "dd.MM.yyyy", locale),
                      },
                      {
                        key: "renewal",
                        label: t("loyalty.fields.renewal_date"),
                        value:
                          s.state === "cancelled"
                            ? date(s.renewal_date, "dd.MM.yyyy", locale)
                            : `${date(s.renewal_date, "dd.MM.yyyy", locale)} · ${renewalLabel(s.days_until_renewal, t)}`,
                      },
                      {
                        key: "uses",
                        label: t("loyalty.fields.uses_per_period"),
                        value: s.uses_per_period
                          ? String(s.uses_per_period)
                          : t("loyalty.fields.unlimited"),
                      },
                      {
                        key: "cancelled",
                        label: t("loyalty.fields.cancelled_at"),
                        value: s.cancelled_at
                          ? datetime(s.cancelled_at, "dd.MM.yyyy HH:mm", locale)
                          : "—",
                      },
                      {
                        key: "notes",
                        label: t("loyalty.fields.notes"),
                        value: s.notes || "—",
                      },
                    ],
                  },
                ]}
              />
            </EntitySectionCard>
          </div>

          <EntitySectionCard
            title={t("loyalty.payments.title")}
            badge={s.payments.length}
          >
            <PaymentsTable rows={s.payments} />
          </EntitySectionCard>
          <EntitySectionCard
            title={t("loyalty.usage.title")}
            badge={s.usage.length}
          >
            <UsageTable slug={slug} rows={s.usage} currency={s.currency} />
          </EntitySectionCard>
          <PaySubscriptionDialog
            open={payOpen}
            onOpenChange={setPayOpen}
            subscription={s}
          />
        </div>
      ) : null}
    </EntityPage>
  );
}
