"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { Timeline, type TimelineItem } from "@/components/common/timeline";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { useCustomerActivity } from "@/features/customers/hooks/use-customers";
import type { CustomerActivityEntry } from "@/features/customers/services/customers.service";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Payload fields that name the record an entry is about, in priority order. */
const DETAIL_KEYS = ["plate", "number", "name", "title", "product"] as const;

function payloadDetail(entry: CustomerActivityEntry): string {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/**
 * Activity timeline of a customer and its records (vehicles, jobs, contracts,
 * sales, quotes, leads, cari entries); kinds the member cannot read are
 * filtered by the API.
 */
export function CustomerActivityTab({
  slug,
  customerUuid,
  cariAccountUuid,
  active,
}: {
  slug: string;
  customerUuid: string;
  cariAccountUuid?: string | null;
  active: boolean;
}) {
  const { t, locale } = useLocale();
  const query = useCustomerActivity(customerUuid, active);
  const refetch = query.refetch;
  useTenantLiveRefetch(
    [
      TenantLiveResources.customers,
      TenantLiveResources.jobs,
      TenantLiveResources.sales,
    ],
    refetch,
    { enabled: active },
  );
  useTenantLiveRefetch(
    [
      TenantLiveResources.quotes,
      TenantLiveResources.leads,
      TenantLiveResources.cariEntries,
    ],
    refetch,
    { enabled: active },
  );

  const items = useMemo<TimelineItem[]>(() => {
    const href = (entry: CustomerActivityEntry): string | undefined => {
      const id = entry.resource_uuid;
      if (!id || entry.action.endsWith(".delete")) return undefined;
      switch (entry.subject) {
        case "job":
          return routes.tenant.operations.detail(slug, id);
        case "sale":
          return routes.tenant.sales.detail(slug, id);
        case "quote":
          return routes.tenant.quotes.detail(slug, id);
        case "lead":
          return routes.tenant.leads.detail(slug, id);
        case "contract":
          return routes.tenant.contracts.instanceDetail(slug, id);
        case "cari_entry":
          return cariAccountUuid
            ? routes.tenant.cari.detail(slug, cariAccountUuid)
            : undefined;
        default:
          return undefined;
      }
    };
    return (query.data?.pages ?? [])
      .flatMap((page) => page.items)
      .map((entry) => {
        const key = `activity.actions.${entry.action}`;
        const label = t(key);
        const actor = entry.actor
          ? `${entry.actor.name} ${entry.actor.surname}`.trim()
          : t("customers.activity.system");
        const description = [
          t(`customers.activity.subject.${entry.subject}`),
          payloadDetail(entry),
          actor,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          id: entry.uuid,
          title: label === key ? entry.action : label,
          description,
          meta: datetime(entry.created_at, "dd.MM.yyyy HH:mm", locale),
          href: href(entry),
        };
      });
  }, [query.data, t, locale, slug, cariAccountUuid]);

  if (query.isLoading) return <Loading className="py-10" />;
  if (query.isError && !query.data) {
    return (
      <ErrorState
        title={t("common.error_generic")}
        onRetry={() => void query.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (!items.length) {
    return (
      <EmptyState
        title={t("customers.activity.empty_title")}
        description={t("customers.activity.empty_description")}
      />
    );
  }
  return (
    <div className="space-y-4">
      <Timeline items={items} />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage
              ? t("common.loading")
              : t("customers.activity.load_more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
