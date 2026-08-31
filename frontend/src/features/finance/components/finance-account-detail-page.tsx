"use client";

// TODO(finance): Header actions — edit account (FinanceAccountDialog edit mode), quick income/expense
// pre-filled with this account, transfer dialog, period filter for KPI stats.

import { Landmark, Wallet } from "lucide-react";

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
import { accountTypeLabelKey } from "@/features/finance/lib/labels";
import { useFinanceAccountDetail } from "@/features/finance/hooks/use-finance-queries";
import { datetime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type FinanceAccountDetailPageProps = {
  slug: string;
  uuid: string;
};

export function FinanceAccountDetailPage({
  slug,
  uuid,
}: FinanceAccountDetailPageProps) {
  const { t, locale } = useLocale();
  const query = useFinanceAccountDetail(uuid);

  const detail = query.data;
  const account = detail?.account;
  const stats = detail?.stats;
  const title = account?.name ?? t("finance.detail.account_title");

  const AccountIcon = account?.type === "bank" ? Landmark : Wallet;

  return (
    <EntityPage
      title={title}
      description={t("finance.detail.account_description")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        {
          label: t("finance.accounts.title"),
          href: routes.tenant.finance.accounts.root(slug),
        },
        { label: title },
      ]}
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("finance.detail.account_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {account && stats ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-muted flex size-10 items-center justify-center rounded-lg">
              <AccountIcon
                aria-hidden
                className="text-muted-foreground size-5"
              />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                label={t(accountTypeLabelKey(account.type))}
                tone="default"
              />
              {account.is_default ? (
                <StatusChip
                  label={t("finance.accounts.default")}
                  tone="default"
                />
              ) : null}
              <StatusChip
                label={
                  account.is_active
                    ? t("finance.filters.active")
                    : t("finance.filters.inactive")
                }
                tone={account.is_active ? "success" : "default"}
              />
              {account.negative_balance ? (
                <StatusChip
                  label={t("finance.detail.negative_balance")}
                  tone="warning"
                />
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardStatCard
              label={t("finance.accounts.current_balance")}
              value={
                <span
                  className={cn(
                    account.negative_balance &&
                      "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatFinanceAmount(
                    account.current_balance,
                    account.currency,
                    locale,
                  )}
                </span>
              }
            />
            <DashboardStatCard
              label={t("finance.detail.total_income")}
              value={formatFinanceAmount(
                stats.total_income,
                account.currency,
                locale,
              )}
              className="border-emerald-500/20 bg-emerald-500/5"
            />
            <DashboardStatCard
              label={t("finance.detail.total_expense")}
              value={formatFinanceAmount(
                stats.total_expense,
                account.currency,
                locale,
              )}
              className="border-rose-500/20 bg-rose-500/5"
            />
            <DashboardStatCard
              label={t("finance.detail.posted_count")}
              value={stats.posted_count}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <EntitySectionCard title={t("finance.detail.account_info")}>
              <EntityDetail
                sections={[
                  {
                    id: "account",
                    fields: [
                      {
                        key: "currency",
                        label: t("finance.accounts.currency"),
                        value: account.currency,
                      },
                      {
                        key: "opening",
                        label: t("finance.accounts.opening_balance"),
                        value: formatFinanceAmount(
                          account.opening_balance,
                          account.currency,
                          locale,
                        ),
                      },
                      {
                        key: "bank",
                        label: t("finance.detail.bank_name"),
                        value: account.bank_name ?? "—",
                      },
                      {
                        key: "iban",
                        label: t("finance.detail.iban"),
                        value: account.iban ? (
                          <span className="font-mono text-xs">
                            {account.iban}
                          </span>
                        ) : (
                          "—"
                        ),
                      },
                      {
                        key: "notes",
                        label: t("finance.detail.notes"),
                        value: account.notes || "—",
                      },
                      {
                        key: "created",
                        label: t("finance.detail.created_at"),
                        value: datetime(account.created_at, undefined, locale),
                      },
                    ],
                  },
                ]}
              />
            </EntitySectionCard>

            <EntitySectionCard title={t("finance.detail.transfer_flow")}>
              <EntityDetail
                sections={[
                  {
                    id: "transfers",
                    fields: [
                      {
                        key: "in",
                        label: t("finance.detail.transfer_in"),
                        value: formatFinanceAmount(
                          stats.transfer_in,
                          account.currency,
                          locale,
                        ),
                      },
                      {
                        key: "out",
                        label: t("finance.detail.transfer_out"),
                        value: formatFinanceAmount(
                          stats.transfer_out,
                          account.currency,
                          locale,
                        ),
                      },
                      {
                        key: "void",
                        label: t("finance.detail.void_count"),
                        value: stats.void_count,
                      },
                    ],
                  },
                ]}
              />
            </EntitySectionCard>
          </div>

          <FinanceLedgerSection
            slug={slug}
            accountUuid={uuid}
            title={t("finance.detail.account_ledger")}
            persistKey={`tenant-finance-account-ledger-${slug}-${uuid}`}
          />
        </div>
      ) : null}
    </EntityPage>
  );
}
