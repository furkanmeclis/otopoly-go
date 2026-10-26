"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  useLoyaltyAccess,
  useLoyaltyOverview,
} from "@/features/loyalty/hooks/use-loyalty";
import {
  renewalLabel,
  subscriptionStateTone,
} from "@/features/loyalty/lib/labels";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { useLocale } from "@/providers/locale-provider";

/** Dashboard card: subscriptions renewing in the next 7 days (overdue first). */
export function LoyaltyRenewalsWidget({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canRead } = useLoyaltyAccess();
  const overview = useLoyaltyOverview(canRead, 7);
  useTenantLiveRefetch(
    TenantLiveResources.loyaltySubscriptions,
    overview.refetch,
    {
      enabled: canRead,
    },
  );
  // Plan without the module, no permission or no subscriptions: no card.
  if (!canRead || overview.isError) return null;
  const o = overview.data;
  if (o && o.subscriptions_active === 0) return null;

  return (
    <section
      className="bg-card flex flex-col rounded-2xl border"
      data-widget="loyalty-renewals"
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="text-primary size-4" />
          {t("loyalty.widget.title")}
        </h2>
        <Link
          href={routes.tenant.loyalty.tab(slug, "subscriptions")}
          className="text-primary text-xs font-medium hover:underline"
        >
          {t("loyalty.widget.open")}
        </Link>
      </div>
      {!o ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : o.renewals.length === 0 ? (
        <p className="text-muted-foreground px-6 py-6 text-center text-sm">
          {t("loyalty.widget.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {o.renewals.map((s) => (
            <li key={s.uuid}>
              <Link
                href={routes.tenant.loyalty.subscription(slug, s.uuid)}
                className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {s.customer_name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {s.name}
                    {s.plate ? ` · ${s.plate}` : ""} ·{" "}
                    {renewalLabel(s.days_until_renewal, t)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm tabular-nums">
                    {formatFinanceAmount(s.price, s.currency, locale)}
                  </span>
                  <StatusChip
                    label={t(`loyalty.subscription_state.${s.state}`)}
                    tone={subscriptionStateTone(s.state)}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
