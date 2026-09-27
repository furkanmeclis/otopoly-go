"use client";

import { FileDown } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Button } from "@/components/ui/button";
import { useBillingInvoices } from "@/features/billing/hooks/use-billing";
import { billingService } from "@/features/billing/services/billing.service";
import type { InvoiceStatus } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export const INVOICE_TONE: Record<
  InvoiceStatus,
  "default" | "success" | "warning" | "danger"
> = {
  issued: "success",
  failed: "warning",
  voided: "default",
};

export function InvoicesCard() {
  const { t, locale } = useLocale();
  const invoices = useBillingInvoices(true);
  const items = invoices.data?.items ?? [];
  return (
    <EntitySectionCard title={t("billing.invoices.title")}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("billing.invoices.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((inv) => (
            <li
              key={inv.uuid}
              className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs">{inv.number}</p>
                <p className="text-muted-foreground text-xs">
                  {date(inv.issue_date, "dd.MM.yyyy", locale)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">
                  {formatFinanceAmount(inv.grand_total, "TRY", locale)}
                </span>
                <StatusChip
                  label={t(`billing.invoices.status.${inv.status}`)}
                  tone={INVOICE_TONE[inv.status]}
                />
                {inv.has_pdf ? (
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href={billingService.invoicePdfUrl(inv.uuid)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileDown className="size-4" />
                      {t("billing.invoices.pdf")}
                    </a>
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("billing.invoices.no_pdf")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </EntitySectionCard>
  );
}
