"use client";

// TODO(finance): Step-up gate before void on sensitive tenants; optimistic UI + confirm dialog copy i18n audit.

import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { EntityPage } from "@/components/entity";
import { routes } from "@/config/routes";
import { FinanceTransactionReport } from "@/features/finance/components/finance-transaction-report";
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import { useFinanceTransaction } from "@/features/finance/hooks/use-finance-queries";
import { useTenantFinanceAccess } from "@/features/finance/hooks/use-tenant-finance-access";
import { transactionTypeLabelKey } from "@/features/finance/lib/labels";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

type FinanceTransactionDetailPageProps = {
  slug: string;
  uuid: string;
};

export function FinanceTransactionDetailPage({
  slug,
  uuid,
}: FinanceTransactionDetailPageProps) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirm } = useDialogs();
  const { canWrite } = useTenantFinanceAccess(slug);
  const { voidTransaction } = useFinanceMutations();
  const query = useFinanceTransaction(uuid);

  const tx = query.data;
  const title = tx
    ? `${t(transactionTypeLabelKey(tx.type))} · ${tx.transaction_date}`
    : t("finance.detail.transaction_title");

  async function handleVoid() {
    if (!tx) return;
    const confirmed = await confirm({
      title: t("finance.detail.void_title"),
      description: t("finance.detail.void_description"),
      confirmLabel: t("finance.transactions.void"),
      variant: "destructive",
    });
    if (!confirmed) return;
    await voidTransaction.mutateAsync(tx.uuid);
    void router.refresh();
  }

  return (
    <EntityPage
      title={title}
      description={t("finance.detail.transaction_description")}
      breadcrumbs={[
        {
          label: t("layout.nav_finance"),
          href: routes.tenant.finance.root(slug),
        },
        {
          label: t("finance.transactions.title"),
          href: routes.tenant.finance.transactions.root(slug),
        },
        { label: title },
      ]}
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("finance.detail.transaction_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {tx ? (
        <FinanceTransactionReport
          slug={slug}
          tx={tx}
          canWrite={canWrite}
          onVoid={() => void handleVoid()}
          voidPending={voidTransaction.isPending}
        />
      ) : null}
    </EntityPage>
  );
}
