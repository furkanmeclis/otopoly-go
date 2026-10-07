"use client";

import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { EntityDetail, EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { INVOICE_TONE } from "@/features/billing/components/invoices-card";
import { ORDER_TONE } from "@/features/billing/components/orders-history";
import { SUBSCRIPTION_STATUS_TONE } from "@/features/billing/components/subscription-page";
import { UsageMeter } from "@/features/billing/components/usage-meter";
import { meterLabel } from "@/features/billing/lib";
import type { BillingSubscription } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import type {
  Organization,
  OrganizationBilling,
} from "@/features/organizations/services/organizations.service";
import { SubscriptionDetailSheet } from "@/features/platform-billing/components/subscription-detail-sheet";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type OrganizationSubscriptionTabProps = {
  organization: Organization;
  billing: OrganizationBilling | null | undefined;
};

function billingLink(base: string, slug: string) {
  return `${base}?q=${encodeURIComponent(slug)}`;
}

/**
 * Plan, period, trial end, entitlements (toggles), usage vs limits and the
 * latest invoices / orders, with links to the platform billing screens.
 */
export function OrganizationSubscriptionTab({
  organization,
  billing,
}: OrganizationSubscriptionTabProps) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const [sheetUuid, setSheetUuid] = useState<string | null>(null);
  const canBilling = can(permissions.platformBilling.read);

  if (!billing) {
    return <EmptyState title={t("organizations.subscription.unavailable")} />;
  }

  const sub = billing.subscription as BillingSubscription | null;
  const toggles = billing.meters.filter((m) => m.kind === "toggle");
  const limits = billing.meters.filter((m) => m.kind === "limit");
  const links = canBilling ? (
    <div className="flex flex-wrap gap-2">
      {sub ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSheetUuid(sub.uuid)}
        >
          {t("billing.subs.detail")}
        </Button>
      ) : null}
      {(
        [
          ["subscriptions", routes.platform.billing.subscriptions],
          ["invoices", routes.platform.billing.invoices],
          ["payments", routes.platform.billing.payments],
        ] as const
      ).map(([key, href]) => (
        <Button key={key} asChild size="sm" variant="ghost">
          <Link href={billingLink(href, organization.slug)}>
            <ExternalLink className="size-3.5" />
            {t(`organizations.subscription.links.${key}`)}
          </Link>
        </Button>
      ))}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <EntitySectionCard
        title={t("organizations.subscription.current")}
        action={links}
      >
        {sub ? (
          <EntityDetail
            sections={[
              {
                id: "subscription",
                fields: [
                  {
                    key: "plan",
                    label: t("organizations.subscription.plan"),
                    value: (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium">{sub.plan_name}</span>
                        <StatusChip
                          label={t(`billing.status.${sub.status}`)}
                          tone={SUBSCRIPTION_STATUS_TONE[sub.status]}
                        />
                      </span>
                    ),
                  },
                  {
                    key: "period",
                    label: t("organizations.subscription.period"),
                    value: t(`billing.period.${sub.period}`),
                  },
                  {
                    key: "starts_at",
                    label: t("billing.subs.starts_at"),
                    value: date(sub.starts_at, "dd.MM.yyyy", locale),
                  },
                  {
                    key: "ends_at",
                    label:
                      sub.status === "trial"
                        ? t("organizations.subscription.trial_ends_at")
                        : t("billing.subs.ends_at"),
                    value: `${date(sub.ends_at, "dd.MM.yyyy", locale)} · ${t(
                      "billing.subs.days",
                      { days: sub.days_left },
                    )}`,
                  },
                  ...(sub.grace_ends_at
                    ? [
                        {
                          key: "grace_ends_at",
                          label: t("organizations.subscription.grace_ends_at"),
                          value: date(sub.grace_ends_at, "dd.MM.yyyy", locale),
                        },
                      ]
                    : []),
                  {
                    key: "credit",
                    label: t("billing.subs.col.credit"),
                    value: formatFinanceAmount(
                      sub.credit_balance,
                      "TRY",
                      locale,
                    ),
                  },
                ],
              },
            ]}
          />
        ) : (
          <EmptyState
            title={t("organizations.subscription.none_title")}
            description={t("organizations.subscription.none_description")}
            className="py-8"
          />
        )}
      </EntitySectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <EntitySectionCard title={t("organizations.subscription.features")}>
          {toggles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("organizations.subscription.features_empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {toggles.map((meter) => (
                <li
                  key={meter.key}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>{meterLabel(meter, locale)}</span>
                  {meter.enabled ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" />
                      {t("organizations.subscription.enabled")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <XCircle className="size-4" />
                      {t("organizations.subscription.disabled")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </EntitySectionCard>

        <EntitySectionCard title={t("organizations.subscription.usage")}>
          {limits.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("billing.usage.empty")}
            </p>
          ) : (
            <div className="space-y-3">
              {limits.map((meter) => (
                <UsageMeter key={meter.key} meter={meter} />
              ))}
            </div>
          )}
        </EntitySectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <EntitySectionCard title={t("organizations.subscription.invoices")}>
          {billing.recent_invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("organizations.subscription.invoices_empty")}
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {billing.recent_invoices.map((inv) => (
                <li
                  key={inv.uuid}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="font-mono text-xs">{inv.number}</span>
                  <span className="text-muted-foreground text-xs">
                    {date(inv.created_at, "dd.MM.yyyy", locale)}
                  </span>
                  <span className="tabular-nums">
                    {formatFinanceAmount(inv.grand_total, "TRY", locale)}
                  </span>
                  <StatusChip
                    label={t(`billing.invoices.status.${inv.status}`)}
                    tone={INVOICE_TONE[inv.status]}
                  />
                  {inv.has_pdf && canBilling ? (
                    <a
                      className="text-primary text-xs underline"
                      href={platformBillingService.invoiceFileUrl(
                        inv.uuid,
                        "pdf",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </EntitySectionCard>

        <EntitySectionCard title={t("organizations.subscription.orders")}>
          {billing.recent_orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("organizations.subscription.orders_empty")}
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {billing.recent_orders.map((order) => (
                <li
                  key={order.uuid}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="font-mono text-xs">
                    {order.reference_code}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {date(order.created_at, "dd.MM.yyyy", locale)}
                  </span>
                  <span className="tabular-nums">
                    {formatFinanceAmount(order.total, "TRY", locale)}
                  </span>
                  <StatusChip
                    label={t(`billing.order.status.${order.status}`)}
                    tone={ORDER_TONE[order.status]}
                  />
                </li>
              ))}
            </ul>
          )}
        </EntitySectionCard>
      </div>

      {canBilling ? (
        <SubscriptionDetailSheet
          uuid={sheetUuid}
          canWrite={false}
          onEdit={() => undefined}
          onOpenChange={(open) => {
            if (!open) setSheetUuid(null);
          }}
        />
      ) : null}
    </div>
  );
}
