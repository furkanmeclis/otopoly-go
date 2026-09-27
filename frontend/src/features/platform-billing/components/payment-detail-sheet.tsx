"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ORDER_TONE } from "@/features/billing/components/orders-history";
import { QuoteLines } from "@/features/billing/components/quote-lines";
import {
  usePlatformOrder,
  usePlatformOrderMutations,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { isApiError } from "@/lib/api";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function PaymentDetailSheet({
  uuid,
  canWrite,
  onOpenChange,
}: {
  uuid: string | null;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const order = usePlatformOrder(uuid);
  const { approve, reject } = usePlatformOrderMutations();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const o = order.data;
  const open = o
    ? o.status === "pending_payment" || o.status === "payment_reported"
    : false;
  const receiptUrl = o ? platformBillingService.receiptUrl(o.uuid) : "";
  const isImage = o?.receipt_content_type?.startsWith("image/");

  const reset = () => {
    setMode("idle");
    setText("");
    setError(null);
  };

  const confirm = async () => {
    if (!o) return;
    setError(null);
    try {
      if (mode === "approve")
        await approve.mutateAsync({ uuid: o.uuid, note: text.trim() });
      if (mode === "reject") {
        if (!text.trim())
          return setError(t("billing.payments.reject_required"));
        await reject.mutateAsync({ uuid: o.uuid, reason: text.trim() });
      }
      reset();
    } catch (err) {
      if (isApiError(err)) setError(err.message);
    }
  };

  return (
    <Sheet
      open={uuid !== null}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("billing.payments.detail")}</SheetTitle>
          {o ? (
            <SheetDescription>
              {o.organization?.name} ·{" "}
              <span className="font-mono">{o.reference_code}</span>
            </SheetDescription>
          ) : null}
        </SheetHeader>
        {!o ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-5 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusChip
                label={t(`billing.order.status.${o.status}`)}
                tone={ORDER_TONE[o.status]}
              />
              <span>
                {o.plan.name} · {t(`billing.period.${o.period}`)} ·{" "}
                <span className="text-muted-foreground">
                  {t(`billing.checkout.kind.${o.kind}`)}
                </span>
              </span>
            </div>
            <QuoteLines
              lines={o.lines}
              total={o.total}
              vatAmount={o.vat_amount}
            />
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">
                {t("billing.payments.col.reported_at")}
              </dt>
              <dd>
                {o.reported_at
                  ? datetime(o.reported_at, "dd.MM.yyyy HH:mm", locale)
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">
                {t("billing.payments.col.expires_at")}
              </dt>
              <dd>{datetime(o.expires_at, "dd.MM.yyyy HH:mm", locale)}</dd>
              {o.report_note ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("billing.payments.note_from_org")}
                  </dt>
                  <dd className="whitespace-pre-line">{o.report_note}</dd>
                </>
              ) : null}
              {o.reject_reason ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("billing.payments.reject_reason")}
                  </dt>
                  <dd>{o.reject_reason}</dd>
                </>
              ) : null}
            </dl>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("billing.payments.receipt")}
              </p>
              {o.has_receipt ? (
                <>
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- API-owned stream, not a static asset
                    <img
                      src={receiptUrl}
                      alt={t("billing.payments.receipt")}
                      className="max-h-96 w-full rounded-md border object-contain"
                    />
                  ) : null}
                  <Button size="sm" variant="outline" asChild>
                    <a href={receiptUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      {t("billing.payments.open_receipt")}
                    </a>
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("billing.payments.no_receipt")}
                </p>
              )}
            </div>
            {canWrite && open ? (
              mode === "idle" ? (
                <div className="flex gap-2">
                  <Button onClick={() => setMode("approve")}>
                    {t("billing.payments.approve")}
                  </Button>
                  <Button variant="outline" onClick={() => setMode("reject")}>
                    {t("billing.payments.reject")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm">
                    {mode === "approve"
                      ? t("billing.payments.approve_confirm")
                      : t("billing.payments.reject_reason")}
                  </p>
                  <Textarea
                    rows={2}
                    value={text}
                    placeholder={
                      mode === "approve"
                        ? t("billing.payments.approve_note")
                        : t("billing.payments.reject_reason")
                    }
                    onChange={(e) => setText(e.target.value)}
                  />
                  {error ? (
                    <p className="text-destructive text-xs">{error}</p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      variant={mode === "reject" ? "destructive" : "default"}
                      disabled={approve.isPending || reject.isPending}
                      onClick={confirm}
                    >
                      {mode === "approve"
                        ? t("billing.payments.approve")
                        : t("billing.payments.reject")}
                    </Button>
                    <Button variant="ghost" onClick={reset}>
                      {t("billing.admin.plan.cancel")}
                    </Button>
                  </div>
                </div>
              )
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
