"use client";

// TODO(finance): Dedicated print stylesheet (@media print), PDF export via io-engine, show created_by
// when API returns actor, link source_type/source_uuid to future domain modules (service_job, etc.).

import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Printer,
} from "lucide-react";
import type { ReactNode } from "react";

import { StatusChip } from "@/components/common/status-chip";
import { Card, CardContent } from "@/components/common/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  transactionStatusLabelKey,
  transactionTypeLabelKey,
} from "@/features/finance/lib/labels";
import type { FinanceTransaction } from "@/features/finance/services/finance.service";
import { datetime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

function TransactionTypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  if (type === "income") {
    return <ArrowDownLeft aria-hidden className={className} />;
  }
  if (type === "expense") {
    return <ArrowUpRight aria-hidden className={className} />;
  }
  return <ArrowRightLeft aria-hidden className={className} />;
}

function typeTone(type: string) {
  if (type === "income") return "text-emerald-600 dark:text-emerald-400";
  if (type === "expense") return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

function sourceTypeLabel(
  t: (key: string) => string,
  sourceType?: string | null,
) {
  if (!sourceType) return "—";
  const key = `finance.detail.source_types.${sourceType}`;
  const label = t(key);
  return label === key ? sourceType : label;
}

function ReportField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-sm break-words">{value ?? "—"}</dd>
    </div>
  );
}

type FinanceTransactionReportProps = {
  slug: string;
  tx: FinanceTransaction;
  canWrite?: boolean;
  onVoid?: () => void;
  voidPending?: boolean;
  showActions?: boolean;
  className?: string;
};

export function FinanceTransactionReport({
  slug,
  tx,
  canWrite,
  onVoid,
  voidPending,
  showActions = true,
  className,
}: FinanceTransactionReportProps) {
  const { t, locale } = useLocale();
  const isVoid = tx.status === "void";

  const accountLink = (
    <Link
      href={routes.tenant.finance.accounts.detail(slug, tx.account_uuid)}
      className="text-primary font-medium hover:underline"
    >
      {tx.account_name}
    </Link>
  );

  const counterLink =
    tx.counter_account_uuid && tx.counter_account_name ? (
      <Link
        href={routes.tenant.finance.accounts.detail(
          slug,
          tx.counter_account_uuid,
        )}
        className="text-primary font-medium hover:underline"
      >
        {tx.counter_account_name}
      </Link>
    ) : (
      "—"
    );

  const categoryLink =
    tx.category_uuid && tx.category_name ? (
      <Link
        href={routes.tenant.finance.categories.detail(slug, tx.category_uuid)}
        className="text-primary font-medium hover:underline"
      >
        {tx.category_name}
      </Link>
    ) : (
      "—"
    );

  return (
    <Card
      className={cn(
        "finance-transaction-report overflow-hidden shadow-none print:border print:shadow-none",
        isVoid && "opacity-90",
        className,
      )}
    >
      <div className="bg-muted/30 border-b px-6 py-5 print:bg-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl",
                tx.type === "income" && "bg-emerald-500/10",
                tx.type === "expense" && "bg-rose-500/10",
                tx.type === "transfer" && "bg-muted",
              )}
            >
              <TransactionTypeIcon
                type={tx.type}
                className={cn("size-6", typeTone(tx.type))}
              />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {t(transactionTypeLabelKey(tx.type))}
                </h2>
                <StatusChip
                  label={t(transactionStatusLabelKey(tx.status))}
                  tone={isVoid ? "default" : "success"}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                {t("finance.detail.report_id")}:{" "}
                <span className="font-mono text-xs">{tx.uuid}</span>
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("finance.transactions.amount")}
            </p>
            <p
              className={cn(
                "text-3xl font-semibold tracking-tight tabular-nums",
                typeTone(tx.type),
                isVoid && "line-through opacity-70",
              )}
            >
              {formatFinanceAmount(tx.amount, tx.currency, locale)}
            </p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 px-6 py-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ReportField
            label={t("finance.transactions.date")}
            value={tx.transaction_date}
          />
          <ReportField
            label={t("finance.transactions.account")}
            value={accountLink}
          />
          {tx.type === "transfer" ? (
            <ReportField
              label={t("finance.transfers.to")}
              value={counterLink}
            />
          ) : (
            <ReportField
              label={t("finance.transactions.category")}
              value={categoryLink}
            />
          )}
          <ReportField
            label={t("finance.transactions.currency")}
            value={tx.currency}
          />
          <ReportField
            label={t("finance.detail.payment_method")}
            value={tx.payment_method || "—"}
          />
          <ReportField
            label={t("finance.detail.reference_no")}
            value={tx.reference_no ?? "—"}
          />
        </dl>

        {tx.description ? (
          <>
            <Separator />
            <ReportField
              label={t("finance.transactions.description")}
              value={<p className="whitespace-pre-wrap">{tx.description}</p>}
            />
          </>
        ) : null}

        {(tx.source_type || tx.source_uuid) && (
          <>
            <Separator />
            <dl className="grid gap-4 sm:grid-cols-2">
              <ReportField
                label={t("finance.detail.source_type")}
                value={sourceTypeLabel(t, tx.source_type)}
              />
              {tx.source_type === "cari_payment" ? (
                <ReportField
                  label={t("finance.detail.source")}
                  value={t("finance.detail.source_cari_payment")}
                />
              ) : null}
              {tx.source_type === "service_job" ? (
                <ReportField
                  label={t("finance.detail.source")}
                  value={t("finance.detail.source_service_job")}
                />
              ) : null}
            </dl>
          </>
        )}

        <Separator />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ReportField
            label={t("finance.detail.created_at")}
            value={datetime(tx.created_at, undefined, locale)}
          />
          <ReportField
            label={t("finance.detail.updated_at")}
            value={datetime(tx.updated_at, undefined, locale)}
          />
          {tx.voided_at ? (
            <ReportField
              label={t("finance.detail.voided_at")}
              value={datetime(tx.voided_at, undefined, locale)}
            />
          ) : null}
        </dl>

        {showActions ? (
          <div className="flex flex-wrap gap-2 pt-2 print:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer aria-hidden className="size-4" />
              {t("finance.detail.print")}
            </Button>
            {canWrite && !isVoid && onVoid ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={voidPending}
                onClick={onVoid}
              >
                <Ban aria-hidden className="size-4" />
                {t("finance.transactions.void")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
