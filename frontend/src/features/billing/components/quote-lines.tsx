"use client";

import type { QuoteLine } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export function QuoteLines({
  lines,
  total,
  vatRate,
  vatAmount,
}: {
  lines: QuoteLine[];
  total: string;
  vatRate?: number;
  vatAmount: string;
}) {
  const { t, locale } = useLocale();
  return (
    <div className="rounded-lg border">
      <ul className="divide-y text-sm">
        {lines.map((line, i) => {
          const negative = line.amount.trim().startsWith("-");
          return (
            <li
              key={`${line.kind}-${i}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className={cn(negative && "text-muted-foreground")}>
                {line.label}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  negative && "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {formatFinanceAmount(line.amount, "TRY", locale)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="bg-muted/40 flex items-end justify-between gap-3 border-t px-3 py-3">
        <div>
          <p className="text-sm font-medium">{t("billing.checkout.total")}</p>
          <p className="text-muted-foreground text-[11px]">
            {t("billing.checkout.vat_note", {
              rate: vatRate ?? 20,
              amount: formatFinanceAmount(vatAmount, "TRY", locale),
            })}
          </p>
        </div>
        <span className="text-xl font-semibold tabular-nums">
          {formatFinanceAmount(total, "TRY", locale)}
        </span>
      </div>
    </div>
  );
}
