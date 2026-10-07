"use client";

import { StatsCard } from "@/components/common/stats-card";
import type { OrganizationStats } from "@/features/organizations/services/organizations.service";
import { datetime, relativeDatetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type OrganizationStatsTabProps = {
  stats: OrganizationStats;
};

/** Record counts and the latest observed activity in the organization. */
export function OrganizationStatsTab({ stats }: OrganizationStatsTabProps) {
  const { t, locale } = useLocale();
  const counts = [
    ["customers", stats.customers],
    ["jobs", stats.jobs],
    ["quotes", stats.quotes],
    ["contracts", stats.contracts],
    ["members", stats.members],
  ] as const;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {counts.map(([key, value]) => (
        <StatsCard
          key={key}
          title={t(`organizations.stats.${key}`)}
          value={value.toLocaleString(locale)}
        />
      ))}
      <StatsCard
        title={t("organizations.stats.last_activity_at")}
        value={
          stats.last_activity_at
            ? relativeDatetime(stats.last_activity_at, locale)
            : t("organizations.stats.never")
        }
        hint={
          stats.last_activity_at
            ? datetime(stats.last_activity_at, undefined, locale)
            : undefined
        }
      />
    </div>
  );
}
