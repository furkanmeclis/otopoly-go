"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ErrorState } from "@/components/common/error-state";
import { StatsCard } from "@/components/common/stats-card";
import { EntityPage, EntityTabsList } from "@/components/entity";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import {
  CampaignsTable,
  CustomerPackagesTable,
  PackagesTable,
  PlansTable,
  SubscriptionsTable,
} from "@/features/loyalty/components/loyalty-tables";
import {
  useLoyaltyAccess,
  useLoyaltyOverview,
} from "@/features/loyalty/hooks/use-loyalty";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useLocale } from "@/providers/locale-provider";

const TABS = [
  "campaigns",
  "packages",
  "plans",
  "sold",
  "subscriptions",
] as const;
type Tab = (typeof TABS)[number];

/** Sadakat ve Paketler: programs (campaigns, packages, plans) and what was sold. */
export function LoyaltyPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { canRead } = useLoyaltyAccess();
  const overview = useLoyaltyOverview(canRead);
  useTenantLiveRefetch(
    [
      TenantLiveResources.loyaltyPrograms,
      TenantLiveResources.loyaltyPackages,
      TenantLiveResources.loyaltySubscriptions,
    ],
    overview.refetch,
    { enabled: canRead },
  );
  const raw = search.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "campaigns";
  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("loyalty.forbidden")}
      />
    );
  }
  const o = overview.data;

  return (
    <EntityPage
      title={t("loyalty.title")}
      description={t("loyalty.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("loyalty.title") },
      ]}
    >
      {overview.isError && isFeatureDisabledError(overview.error) ? (
        <FeatureLocked slug={slug} />
      ) : (
        <>
          {o ? (
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatsCard
                title={t("loyalty.stats.campaigns")}
                value={o.active_campaigns}
              />
              <StatsCard
                title={t("loyalty.stats.packages_active")}
                value={o.customer_packages_active}
              />
              <StatsCard
                title={t("loyalty.stats.subscriptions")}
                value={o.subscriptions_active}
              />
              <StatsCard
                title={t("loyalty.stats.renewals", { days: o.horizon_days })}
                value={o.renewals_upcoming + o.subscriptions_past_due}
              />
            </div>
          ) : null}
          <Tabs value={tab} onValueChange={setTab}>
            <EntityTabsList
              items={[
                { value: "campaigns", label: t("loyalty.tabs.campaigns") },
                { value: "packages", label: t("loyalty.tabs.packages") },
                { value: "plans", label: t("loyalty.tabs.plans") },
                {
                  value: "sold",
                  label: t("loyalty.tabs.sold"),
                  badge: o?.customer_packages_active ?? null,
                },
                {
                  value: "subscriptions",
                  label: t("loyalty.tabs.subscriptions"),
                  badge: o ? o.subscriptions_past_due || null : null,
                },
              ]}
            />
            <TabsContent value="campaigns" className="mt-4">
              <CampaignsTable slug={slug} />
            </TabsContent>
            <TabsContent value="packages" className="mt-4">
              <PackagesTable slug={slug} />
            </TabsContent>
            <TabsContent value="plans" className="mt-4">
              <PlansTable slug={slug} />
            </TabsContent>
            <TabsContent value="sold" className="mt-4">
              <CustomerPackagesTable slug={slug} />
            </TabsContent>
            <TabsContent value="subscriptions" className="mt-4">
              <SubscriptionsTable slug={slug} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </EntityPage>
  );
}
