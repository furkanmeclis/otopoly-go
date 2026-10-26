"use client";

import { Gift, Package, Repeat, Undo2 } from "lucide-react";
import { createElement } from "react";

import { EntitySectionCard } from "@/components/entity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { StampCardView } from "@/features/loyalty/components/stamp-card";
import {
  useJobLoyalty,
  useLoyaltyAccess,
  useLoyaltyMutations,
} from "@/features/loyalty/hooks/use-loyalty";
import type { LoyaltyKind } from "@/features/loyalty/services/loyalty.service";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { useLocale } from "@/providers/locale-provider";

const KIND_ICON = {
  reward: Gift,
  package: Package,
  subscription: Repeat,
} as const;

export function kindIcon(kind: LoyaltyKind) {
  return KIND_ICON[kind];
}

/**
 * "Kampanya / Paket / Abonelik" on the job: what is applied, what can be
 * applied (open, unpaid jobs) and the customer's stamp cards. Hidden when the
 * module is off in the plan or the member cannot read loyalty.
 */
export function JobLoyaltySection({
  jobUuid,
  currency,
  canWriteJob,
}: {
  jobUuid: string;
  currency: string;
  canWriteJob: boolean;
}) {
  const { t, locale } = useLocale();
  const { canRead, canApply } = useLoyaltyAccess();
  const query = useJobLoyalty(jobUuid, canRead);
  useTenantLiveRefetch(
    [TenantLiveResources.loyaltyCustomers, TenantLiveResources.jobs],
    query.refetch,
    { enabled: canRead },
  );
  const { apply, revert } = useLoyaltyMutations();
  const data = query.data;
  if (!canRead || !data) return null;
  const canChange = data.editable && canApply && canWriteJob;
  const applied = data.applied.filter((a) => a.status === "applied");
  const money = (v: string) => formatFinanceAmount(v, currency, locale);
  if (
    !applied.length &&
    !data.options.length &&
    !data.stamps.length &&
    !data.stamps_earned.length
  ) {
    return null;
  }

  return (
    <EntitySectionCard
      title={t("loyalty.job.title")}
      badge={data.options.length || undefined}
    >
      <div className="space-y-4">
        {applied.length ? (
          <ul className="divide-border divide-y text-sm">
            {applied.map((a) => (
              <li
                key={a.uuid}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {createElement(KIND_ICON[a.kind], {
                    className: "text-primary size-4 shrink-0",
                  })}
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {a.line_name}{" "}
                      <Badge variant="secondary" className="ms-1">
                        {t(`loyalty.kind_badge.${a.kind}`)}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {a.source_name}
                      {a.kind !== "reward"
                        ? ` · ${t("loyalty.job.units", { count: a.units })}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                    −{money(a.discount_amount)}
                  </span>
                  {canChange ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={revert.isPending}
                      onClick={() =>
                        void revert.mutateAsync({
                          jobUuid,
                          applicationUuid: a.uuid,
                        })
                      }
                    >
                      <Undo2 className="size-4" />
                      {t("loyalty.job.revert")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {data.editable && data.options.length ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              {t("loyalty.job.available")}
            </p>
            <ul className="space-y-2">
              {data.options.map((o) => (
                <li
                  key={`${o.kind}-${o.source_uuid}-${o.line_uuid}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {createElement(KIND_ICON[o.kind], {
                      className: "text-primary size-4 shrink-0",
                    })}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.source_name}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {o.line_name}
                        {o.kind !== "reward"
                          ? ` · ${t("loyalty.job.units", { count: o.units })}`
                          : ""}
                        {o.remaining != null
                          ? ` · ${t("loyalty.job.remaining_after", { count: o.remaining })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">
                      −{money(o.discount_amount)}
                    </span>
                    {canChange ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={apply.isPending}
                        onClick={() =>
                          void apply.mutateAsync({
                            jobUuid,
                            body: {
                              kind: o.kind,
                              source_uuid: o.source_uuid,
                              line_uuid: o.line_uuid,
                            },
                          })
                        }
                      >
                        {t(`loyalty.job.apply_${o.kind}`)}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.stamps_earned.length ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t("loyalty.job.stamp_earned", {
              names: data.stamps_earned.map((s) => s.name).join(", "),
            })}
          </p>
        ) : null}

        {data.stamps.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.stamps.map((c) => (
              <StampCardView key={c.campaign_uuid} card={c} />
            ))}
          </div>
        ) : null}
      </div>
    </EntitySectionCard>
  );
}
