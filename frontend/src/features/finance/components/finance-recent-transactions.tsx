"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  transactionStatusLabelKey,
  transactionTypeLabelKey,
} from "@/features/finance/lib/labels";
import { useFinanceTransactions } from "@/features/finance/hooks/use-finance-queries";
import { cn } from "@/lib/utils";
import { date as formatDate } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

function typeIcon(type: string) {
  if (type === "income") return ArrowDownLeft;
  if (type === "expense") return ArrowUpRight;
  return ArrowRightLeft;
}

export function FinanceRecentTransactions({
  slug,
  dateFrom,
  dateTo,
  limit = 8,
}: {
  slug: string;
  dateFrom: string;
  dateTo: string;
  limit?: number;
}) {
  const { t, locale } = useLocale();
  const txQuery = useFinanceTransactions({
    limit,
    offset: 0,
    date_from: dateFrom,
    date_to: dateTo,
  });

  const items = txQuery.data?.items ?? [];

  return (
    <Card className="shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-medium">
          {t("finance.summary.recent_transactions")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={routes.tenant.finance.transactions.root(slug)}>
            {t("finance.summary.view_transactions")}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {txQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length ? (
          <div className="divide-y rounded-lg border">
            {items.map((tx) => {
              const Icon = typeIcon(tx.type);
              return (
                <Link
                  key={tx.uuid}
                  href={routes.tenant.finance.transactions.detail(
                    slug,
                    tx.uuid,
                  )}
                  className={cn(
                    "hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                    tx.status === "void" && "opacity-60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        tx.type === "income" &&
                          "bg-emerald-500/10 text-emerald-600",
                        tx.type === "expense" && "bg-rose-500/10 text-rose-600",
                        tx.type === "transfer" &&
                          "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon aria-hidden className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div
                        className="truncate text-sm font-medium"
                        title={tx.description || undefined}
                      >
                        {tx.description?.trim() ||
                          t(transactionTypeLabelKey(tx.type))}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {[
                          t(transactionTypeLabelKey(tx.type)),
                          formatDate(tx.transaction_date, "dd.MM.yyyy", locale),
                          tx.account_name,
                          tx.category_name,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        tx.type === "income" && "text-emerald-600",
                        tx.type === "expense" && "text-rose-600",
                        tx.status === "void" && "line-through",
                      )}
                    >
                      {tx.type === "expense"
                        ? "−"
                        : tx.type === "income"
                          ? "+"
                          : ""}
                      {formatFinanceAmount(tx.amount, tx.currency, locale)}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t(transactionStatusLabelKey(tx.status))}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={t("finance.transactions.empty")}
            description={t("finance.summary.recent_transactions_empty")}
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
