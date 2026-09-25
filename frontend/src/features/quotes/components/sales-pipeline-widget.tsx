"use client";

import { AlarmClock, FileText } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  useLeadsAccess,
  useLeadSummary,
} from "@/features/leads/hooks/use-leads";
import {
  useQuotesAccess,
  useQuoteSummary,
} from "@/features/quotes/hooks/use-quotes";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Compact dashboard strip: leads to follow up + open quotes. */
export function SalesPipelineWidget({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const leadsAccess = useLeadsAccess();
  const quotesAccess = useQuotesAccess();
  const leads = useLeadSummary(leadsAccess.canRead);
  const quotes = useQuoteSummary(quotesAccess.canRead);
  if (!leadsAccess.canRead && !quotesAccess.canRead) return null;

  const tiles = [
    leadsAccess.canRead
      ? {
          key: "follow",
          href: routes.tenant.leads.root(slug),
          icon: AlarmClock,
          label: t("dashboard.pipeline.follow_up"),
          value: String(
            (leads.data?.overdue ?? 0) + (leads.data?.due_today ?? 0),
          ),
          hint: leads.data?.overdue
            ? t("dashboard.pipeline.overdue", { count: leads.data.overdue })
            : t("dashboard.pipeline.open_leads", {
                count: leads.data?.open ?? 0,
              }),
          danger: (leads.data?.overdue ?? 0) > 0,
          loading: leads.isLoading,
        }
      : null,
    quotesAccess.canRead
      ? {
          key: "quotes",
          href: routes.tenant.quotes.root(slug),
          icon: FileText,
          label: t("dashboard.pipeline.open_quotes"),
          value: formatFinanceAmount(
            quotes.data?.pending_total ?? "0",
            quotes.data?.currency ?? "TRY",
            locale,
          ),
          hint: quotes.data?.expiring_soon
            ? t("dashboard.pipeline.expiring", {
                count: quotes.data.expiring_soon,
              })
            : t("dashboard.pipeline.awaiting", {
                count: quotes.data?.awaiting_count ?? 0,
              }),
          danger: false,
          loading: quotes.isLoading,
        }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <section className="grid gap-3 sm:grid-cols-2" data-widget="pipeline">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Link
            key={tile.key}
            href={tile.href}
            className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-4 transition-colors"
          >
            <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{tile.label}</p>
              {tile.loading ? (
                <Skeleton className="mt-1 h-6 w-20" />
              ) : (
                <p className="truncate text-lg font-semibold tabular-nums">
                  {tile.value}
                </p>
              )}
              <p
                className={cn(
                  "truncate text-xs",
                  tile.danger ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {tile.hint}
              </p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
