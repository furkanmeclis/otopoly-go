"use client";

// TODO(finance): Edit category dialog, period-scoped stats filter, parent category breadcrumb.

import { Tag } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { routes } from "@/config/routes";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import { FinanceLedgerSection } from "@/features/finance/components/finance-ledger-section";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useFinanceCategoryDetail } from "@/features/finance/hooks/use-finance-queries";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type FinanceCategoryDetailPageProps = {
  slug: string;
  uuid: string;
};

export function FinanceCategoryDetailPage({
  slug,
  uuid,
}: FinanceCategoryDetailPageProps) {
  const { t, locale } = useLocale();
  const query = useFinanceCategoryDetail(uuid);

  const detail = query.data;
  const category = detail?.category;
  const stats = detail?.stats;
  const title = category?.name ?? t("finance.detail.category_title");
  // TODO(finance): Derive display currency from org settings or account mix instead of hardcoded TRY.
  const currency = "TRY";

  return (
    <EntityPage
      title={title}
      description={t("finance.detail.category_description")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        {
          label: t("finance.categories.title"),
          href: routes.tenant.finance.categories.root(slug),
        },
        { label: title },
      ]}
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("finance.detail.category_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {category && stats ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-lg",
                category.kind === "income"
                  ? "bg-emerald-500/10"
                  : "bg-rose-500/10",
              )}
            >
              <Tag
                aria-hidden
                className={cn(
                  "size-5",
                  category.kind === "income"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                label={
                  category.kind === "income"
                    ? t("finance.categories.kind_income")
                    : t("finance.categories.kind_expense")
                }
                tone={category.kind === "income" ? "success" : "warning"}
              />
              <StatusChip
                label={
                  category.is_active
                    ? t("finance.filters.active")
                    : t("finance.filters.inactive")
                }
                tone={category.is_active ? "success" : "default"}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <DashboardStatCard
              label={t("finance.detail.total_amount")}
              value={formatFinanceAmount(stats.total_amount, currency, locale)}
              className={
                category.kind === "expense"
                  ? "border-rose-500/20 bg-rose-500/5"
                  : "border-emerald-500/20 bg-emerald-500/5"
              }
            />
            <DashboardStatCard
              label={t("finance.detail.posted_count")}
              value={stats.posted_count}
            />
            <DashboardStatCard
              label={t("finance.detail.void_count")}
              value={stats.void_count}
            />
          </div>

          <EntitySectionCard title={t("finance.detail.category_info")}>
            <EntityDetail
              sections={[
                {
                  id: "category",
                  fields: [
                    {
                      key: "kind",
                      label: t("finance.categories.kind"),
                      value:
                        category.kind === "income"
                          ? t("finance.categories.kind_income")
                          : t("finance.categories.kind_expense"),
                    },
                    {
                      key: "sort",
                      label: t("finance.categories.sort_order"),
                      value: category.sort_order,
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <FinanceLedgerSection
            slug={slug}
            categoryUuid={uuid}
            title={t("finance.detail.category_ledger")}
            persistKey={`tenant-finance-category-ledger-${slug}-${uuid}`}
          />
        </div>
      ) : null}
    </EntityPage>
  );
}
