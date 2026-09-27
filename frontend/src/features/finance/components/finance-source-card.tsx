"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import type { FinanceSourceDetail } from "@/features/finance/services/finance.service";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

function sourceHref(slug: string, d: FinanceSourceDetail): string {
  switch (d.kind) {
    case "service_job":
      return routes.tenant.operations.detail(slug, d.uuid);
    case "product_sale":
      return routes.tenant.sales.detail(slug, d.uuid);
    case "purchase":
      return routes.tenant.purchases.detail(slug, d.uuid);
    case "cari_payment":
      return routes.tenant.cari.detail(slug, d.uuid);
  }
}

/**
 * What the money was for: the job / sale / purchase lines (or the cari
 * account for collections), linked to the source document.
 */
export function FinanceSourceCard({
  slug,
  detail,
  currency,
}: {
  slug: string;
  detail: FinanceSourceDetail;
  currency: string;
}) {
  const { t, locale } = useLocale();
  const cur = detail.currency || currency;
  const money = (v: string) => formatFinanceAmount(v, cur, locale);

  return (
    <section className="overflow-hidden rounded-xl border print:break-inside-avoid">
      <div className="bg-muted/30 flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 print:bg-transparent">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t(`finance.detail.source_types.${detail.kind}`)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {detail.plate ? (
              <PlateBadge plate={detail.plate} size="sm" />
            ) : null}
            <span className="font-semibold">
              {detail.title ||
                (detail.kind === "product_sale"
                  ? t("finance.detail.walk_in_sale")
                  : "—")}
            </span>
          </div>
          {detail.subtitle || detail.date ? (
            <p className="text-muted-foreground text-xs">
              {[
                detail.subtitle,
                detail.date
                  ? datetime(detail.date, "dd.MM.yyyy HH:mm", locale)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <Button asChild size="sm" variant="outline" className="print:hidden">
          <Link href={sourceHref(slug, detail)}>
            <ExternalLink className="size-3.5" />
            {t(`finance.detail.open_source.${detail.kind}`)}
          </Link>
        </Button>
      </div>

      {detail.lines.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">
                {t("finance.detail.lines.item")}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("finance.detail.lines.qty")}
              </th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell print:table-cell">
                {t("finance.detail.lines.unit_price")}
              </th>
              <th className="px-4 py-2 text-right font-medium">
                {t("finance.detail.lines.total")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {detail.lines.map((line, i) => (
              <tr key={`${line.name}-${i}`}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        line.type === "service"
                          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          : line.type === "product"
                            ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {t(`finance.detail.lines.types.${line.type}`)}
                    </span>
                    <span className="font-medium">{line.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatQuantity(line.qty, locale)}
                </td>
                <td className="text-muted-foreground hidden px-3 py-2.5 text-right tabular-nums sm:table-cell print:table-cell">
                  {money(line.unit_price)}
                </td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                  {money(line.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
          {detail.total ? (
            <tfoot>
              <tr className="bg-muted/30 border-t print:bg-transparent">
                <td
                  colSpan={2}
                  className="px-4 py-2.5 text-sm font-semibold sm:hidden"
                >
                  {t("finance.detail.lines.document_total")}
                </td>
                <td
                  colSpan={3}
                  className="hidden px-4 py-2.5 text-sm font-semibold sm:table-cell print:table-cell"
                >
                  {t("finance.detail.lines.document_total")}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {money(detail.total)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      ) : null}
    </section>
  );
}
