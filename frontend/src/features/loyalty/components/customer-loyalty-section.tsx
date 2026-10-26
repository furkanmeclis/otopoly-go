"use client";

import Link from "next/link";
import { useState } from "react";
import { PackagePlus, Repeat } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import { SellPackageDialog } from "@/features/loyalty/components/sell-package-dialog";
import { StampCardView } from "@/features/loyalty/components/stamp-card";
import { StartSubscriptionDialog } from "@/features/loyalty/components/start-subscription-dialog";
import {
  useCustomerLoyalty,
  useLoyaltyAccess,
} from "@/features/loyalty/hooks/use-loyalty";
import {
  renewalLabel,
  subscriptionStateTone,
} from "@/features/loyalty/lib/labels";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Customer 360: stamps, usable packages and subscriptions + sell / start. */
export function CustomerLoyaltySection({
  slug,
  customerUuid,
  customerName,
  compact = false,
}: {
  slug: string;
  customerUuid: string;
  customerName: string;
  /** Overview card: summary only, no actions. */
  compact?: boolean;
}) {
  const { t, locale } = useLocale();
  const { canRead, canApply } = useLoyaltyAccess();
  const query = useCustomerLoyalty(customerUuid, canRead);
  useTenantLiveRefetch(TenantLiveResources.loyaltyCustomers, query.refetch, {
    uuid: customerUuid,
    enabled: canRead,
  });
  const [sellOpen, setSellOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  if (!canRead) return null;
  if (query.isError) {
    if (compact) return null;
    return isFeatureDisabledError(query.error) ? (
      <FeatureLocked slug={slug} />
    ) : null;
  }
  const data = query.data;
  if (!data) return null;
  const empty =
    data.stamps.length === 0 &&
    data.packages.length === 0 &&
    data.subscriptions.length === 0;
  if (compact && empty) return null;

  const body = (
    <div className="space-y-4">
      {data.subscriptions.length ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {t("loyalty.tabs.subscriptions")}
          </p>
          {data.subscriptions.map((s) => (
            <Link
              key={s.uuid}
              href={routes.tenant.loyalty.subscription(slug, s.uuid)}
              className="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {s.name}
                  {s.plate ? ` · ${s.plate}` : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("loyalty.fields.renewal_date")}:{" "}
                  {date(s.renewal_date, "dd.MM.yyyy", locale)} ·{" "}
                  {renewalLabel(s.days_until_renewal, t)}
                </p>
                {s.current_period ? (
                  <p className="text-muted-foreground text-xs">
                    {s.current_period.limit
                      ? t("loyalty.subscriptions.used_of", {
                          used: s.current_period.used,
                          limit: s.current_period.limit,
                        })
                      : t("loyalty.subscriptions.used_unlimited", {
                          used: s.current_period.used,
                        })}
                  </p>
                ) : null}
              </div>
              <StatusChip
                label={t(`loyalty.subscription_state.${s.state}`)}
                tone={subscriptionStateTone(s.state)}
              />
            </Link>
          ))}
        </div>
      ) : null}
      {data.packages.length ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {t("loyalty.tabs.packages")}
          </p>
          {data.packages.map((p) => (
            <Link
              key={p.uuid}
              href={routes.tenant.loyalty.customerPackage(slug, p.uuid)}
              className="hover:bg-muted/40 block space-y-2 rounded-xl border p-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {p.expires_at
                    ? t("loyalty.packages.expires_on", {
                        date: date(p.expires_at, "dd.MM.yyyy", locale),
                      })
                    : t("loyalty.packages.no_expiry")}
                </span>
              </div>
              {p.credits.map((c) => (
                <div key={c.service_uuid} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>{c.service_name}</span>
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
                </div>
              ))}
            </Link>
          ))}
        </div>
      ) : null}
      {data.stamps.length ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {t("loyalty.tabs.campaigns")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.stamps.map((c) => (
              <StampCardView key={c.campaign_uuid} card={c} />
            ))}
          </div>
        </div>
      ) : null}
      {empty ? (
        <p className="text-muted-foreground text-sm">
          {t("loyalty.customer.empty")}
        </p>
      ) : null}
    </div>
  );

  return (
    <EntitySectionCard
      title={t("loyalty.customer.title")}
      badge={data.rewards_available || undefined}
      action={
        !compact && canApply ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSellOpen(true)}
            >
              <PackagePlus className="size-4" />
              {t("loyalty.sell.title")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStartOpen(true)}
            >
              <Repeat className="size-4" />
              {t("loyalty.start.title")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {body}
      {!compact ? (
        <>
          <SellPackageDialog
            open={sellOpen}
            onOpenChange={setSellOpen}
            customerUuid={customerUuid}
            customerName={customerName}
          />
          <StartSubscriptionDialog
            open={startOpen}
            onOpenChange={setStartOpen}
            customerUuid={customerUuid}
            customerName={customerName}
          />
        </>
      ) : null}
    </EntitySectionCard>
  );
}
