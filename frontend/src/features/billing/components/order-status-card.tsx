"use client";

import { Check, ExternalLink, Upload } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Button } from "@/components/ui/button";
import { BankInstructions } from "@/features/billing/components/bank-instructions";
import { QuoteLines } from "@/features/billing/components/quote-lines";
import { ReportPaymentDialog } from "@/features/billing/components/report-payment-dialog";
import { useBillingOrderMutations } from "@/features/billing/hooks/use-billing";
import { billingService } from "@/features/billing/services/billing.service";
import type { BillingOrder } from "@/features/billing/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const STEPS = ["pending_payment", "payment_reported", "approved"] as const;

export function OrderStatusCard({
  order,
  canWrite,
}: {
  order: BillingOrder;
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [showBank, setShowBank] = useState(order.status === "pending_payment");
  const { cancel } = useBillingOrderMutations();
  const current = STEPS.indexOf(order.status as (typeof STEPS)[number]);

  return (
    <EntitySectionCard
      title={t("billing.order.title")}
      badge={order.reference_code}
      className="border-primary/40"
    >
      <ol className="mb-4 flex items-center gap-2 text-xs">
        {STEPS.map((step, i) => (
          <li key={step} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                i < current && "border-emerald-500 bg-emerald-500 text-white",
                i === current &&
                  "border-primary bg-primary text-primary-foreground",
              )}
            >
              {i < current ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                i === current ? "font-medium" : "text-muted-foreground",
              )}
            >
              {t(`billing.order.step.${step}`)}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="bg-border h-px flex-1" />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {order.plan.name} · {t(`billing.period.${order.period}`)} ·{" "}
            <span className="text-muted-foreground">
              {t(`billing.checkout.kind.${order.kind}`)}
            </span>
          </p>
          <QuoteLines
            lines={order.lines}
            total={order.total}
            vatAmount={order.vat_amount}
          />
        </div>
        <div className="space-y-3">
          {order.status === "payment_reported" ? (
            <p className="rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-800 dark:text-sky-300">
              {t("billing.order.reported_note")}
            </p>
          ) : null}
          {order.instructions ? (
            <>
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setShowBank((v) => !v)}
              >
                {showBank
                  ? t("billing.order.hide_instructions")
                  : t("billing.order.show_instructions")}
              </Button>
              {showBank ? (
                <BankInstructions
                  instructions={order.instructions}
                  expiresAt={order.expires_at}
                />
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <Button size="sm" onClick={() => setReportOpen(true)}>
                <Upload className="size-4" />
                {order.has_receipt
                  ? t("billing.order.report_again")
                  : t("billing.order.report")}
              </Button>
            ) : null}
            {order.has_receipt ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={billingService.receiptUrl(order.uuid)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" />
                  {t("billing.order.receipt")}
                </a>
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCancelOpen(true)}
              >
                {t("billing.order.cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ReportPaymentDialog
        orderUuid={order.uuid}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
      <ConfirmDialog
        open={cancelOpen}
        title={t("billing.order.cancel")}
        description={t("billing.order.cancel_confirm")}
        variant="destructive"
        isPending={cancel.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(order.uuid);
          } catch {
            /* toast via global handler */
          }
          setCancelOpen(false);
        }}
      />
    </EntitySectionCard>
  );
}
