"use client";

import { FileCode, FileDown, RefreshCw, Search, XCircle } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EntityPage } from "@/components/entity/entity-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import { INVOICE_TONE } from "@/features/billing/components/invoices-card";
import type { BillingInvoice, InvoiceStatus } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  usePlatformBillingAccess,
  usePlatformInvoiceMutations,
  usePlatformInvoices,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUSES: InvoiceStatus[] = ["issued", "failed", "voided"];
const ALL = "__all__";

export function InvoicesPage() {
  const { t, locale } = useLocale();
  const access = usePlatformBillingAccess();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [voiding, setVoiding] = useState<BillingInvoice | null>(null);
  const list = usePlatformInvoices(
    {
      status: status === ALL ? undefined : status,
      q: q.trim() || undefined,
      limit: 100,
    },
    access.canRead,
  );
  const { regenerate, void: voidMut } = usePlatformInvoiceMutations();
  const items = list.data?.items ?? [];

  return (
    <EntityPage
      title={t("billing.invoices.admin_title")}
      description={t("billing.invoices.admin_description")}
      permission={permissions.platformBilling.read}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("billing.invoices.search")}
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t("billing.invoices.filter_all")}
            </SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`billing.invoices.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={t("billing.invoices.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-normal">
                  {t("billing.invoices.number")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.invoices.organization")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.invoices.buyer")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.invoices.date")}
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  {t("billing.invoices.amount")}
                </th>
                <th className="px-3 py-2 font-normal">
                  {t("billing.invoices.status")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((inv) => (
                <tr key={inv.uuid}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {inv.number}
                    <p className="text-muted-foreground font-sans">
                      {inv.order_reference}
                    </p>
                  </td>
                  <td className="px-3 py-2">{inv.organization?.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {inv.buyer.is_final_consumer
                      ? t("billing.invoices.final_consumer")
                      : inv.buyer.name}
                    <p className="text-muted-foreground">{inv.buyer.tax_id}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {date(inv.issue_date, "dd.MM.yyyy", locale)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatFinanceAmount(inv.grand_total, "TRY", locale)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      title={
                        inv.error
                          ? t("billing.invoices.error", { error: inv.error })
                          : undefined
                      }
                    >
                      <StatusChip
                        label={t(`billing.invoices.status.${inv.status}`)}
                        tone={INVOICE_TONE[inv.status]}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {inv.has_xml ? (
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={platformBillingService.invoiceFileUrl(
                            inv.uuid,
                            "xml",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          title={t("billing.invoices.xml")}
                        >
                          <FileCode className="size-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {inv.has_pdf ? (
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={platformBillingService.invoiceFileUrl(
                            inv.uuid,
                            "pdf",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          title={t("billing.invoices.pdf")}
                        >
                          <FileDown className="size-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {access.canWrite && inv.status !== "voided" ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t("billing.invoices.regenerate")}
                          disabled={regenerate.isPending}
                          onClick={() => regenerate.mutate(inv.uuid)}
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t("billing.invoices.void")}
                          onClick={() => setVoiding(inv)}
                        >
                          <XCircle className="size-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={voiding !== null}
        title={t("billing.invoices.void")}
        description={t("billing.invoices.void_confirm")}
        variant="destructive"
        isPending={voidMut.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={async () => {
          if (!voiding) return;
          try {
            await voidMut.mutateAsync(voiding.uuid);
          } catch {
            /* toast via global handler */
          }
          setVoiding(null);
        }}
      />
    </EntityPage>
  );
}
