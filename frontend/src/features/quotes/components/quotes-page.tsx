"use client";

import { ChevronRight, Eye, FileText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import {
  useQuotes,
  useQuotesAccess,
  useQuoteSummary,
} from "@/features/quotes/hooks/use-quotes";
import { quoteStatusTone } from "@/features/quotes/lib/quote-ui";
import type { Quote, QuoteListParams } from "@/features/quotes/types";
import { cn } from "@/lib/utils";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const TABS = [
  "open",
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "all",
] as const;
type Tab = (typeof TABS)[number];

export function QuotesPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const access = useQuotesAccess();
  const [tab, setTab] = useState<Tab>("open");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(h);
  }, [q]);
  const params = useMemo<QuoteListParams>(
    () => ({
      limit: 100,
      ...(tab !== "all" ? { status: tab } : {}),
      ...(debounced ? { q: debounced } : {}),
    }),
    [tab, debounced],
  );
  const list = useQuotes(params, access.canRead);
  const summary = useQuoteSummary(access.canRead);

  if (!access.canRead) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {t("quotes.forbidden")}
      </p>
    );
  }
  const items = list.data?.items ?? [];
  const s = summary.data;
  const money = (v?: string) =>
    formatFinanceAmount(v ?? "0", s?.currency ?? "TRY", locale);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileText className="text-primary size-6" />
            {t("quotes.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("quotes.description")}
          </p>
        </div>
        {access.canWrite ? (
          <Button asChild size="sm">
            <Link href={routes.tenant.quotes.new(slug)}>
              <Plus className="size-4" />
              {t("quotes.actions.create")}
            </Link>
          </Button>
        ) : null}
      </header>

      <dl className="bg-card grid grid-cols-2 gap-3 rounded-2xl border p-3 sm:grid-cols-4">
        {[
          {
            label: t("quotes.summary.awaiting"),
            value: String(s?.awaiting_count ?? 0),
          },
          {
            label: t("quotes.summary.pending_total"),
            value: money(s?.pending_total),
            accent: true,
          },
          {
            label: t("quotes.summary.expiring"),
            value: String(s?.expiring_soon ?? 0),
            tone: s?.expiring_soon ? "text-amber-600" : undefined,
          },
          {
            label: t("quotes.summary.accepted_month"),
            value: `${s?.accepted_month ?? 0} · ${money(s?.accepted_month_total)}`,
          },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-muted-foreground truncate text-xs">
              {stat.label}
            </dt>
            <dd
              className={cn(
                "truncate text-base font-semibold tabular-nums",
                stat.accent && "text-primary",
                stat.tone,
              )}
            >
              {summary.isLoading ? (
                <Skeleton className="mt-1 h-5 w-16" />
              ) : (
                stat.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              {TABS.map((k) => (
                <TabsTrigger key={k} value={k}>
                  {k === "open" || k === "all"
                    ? t(`quotes.tabs.${k}`)
                    : t(`quotes.status.${k}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="relative lg:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("quotes.search")}
            className="pl-8"
          />
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          title={t("quotes.error")}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={debounced ? t("quotes.empty_filtered") : t("quotes.empty")}
          description={debounced ? undefined : t("quotes.empty_hint")}
          action={
            access.canWrite && !debounced ? (
              <Button asChild size="sm">
                <Link href={routes.tenant.quotes.new(slug)}>
                  <Plus className="size-4" />
                  {t("quotes.actions.create")}
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-2xl border">
          {items.map((quote) => (
            <QuoteRow key={quote.uuid} quote={quote} slug={slug} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteRow({ quote, slug }: { quote: Quote; slug: string }) {
  const { t, locale } = useLocale();
  const open =
    quote.status === "draft" ||
    quote.status === "sent" ||
    quote.status === "viewed";
  return (
    <li>
      <Link
        href={routes.tenant.quotes.detail(slug, quote.uuid)}
        className="hover:bg-muted/40 flex flex-col gap-1.5 p-3 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:px-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
            {quote.number}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{quote.customer_name}</p>
            <p className="text-muted-foreground flex items-center gap-2 truncate text-xs">
              {quote.vehicle_plate ? (
                <PlateBadge plate={quote.vehicle_plate} size="sm" />
              ) : null}
              {quote.vehicle_label ||
                t("quotes.lines_count", { count: quote.line_count })}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="flex items-center gap-2">
            <StatusChip
              label={t(`quotes.status.${quote.status}`)}
              tone={quoteStatusTone(quote.status)}
            />
            {quote.viewed_at ? (
              <Eye className="text-muted-foreground size-3.5" />
            ) : null}
          </span>
          <span
            className={cn(
              "w-24 text-xs sm:text-right",
              open && quote.is_past_valid_until
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {quote.valid_until
              ? date(quote.valid_until, "dd MMM", locale)
              : "—"}
          </span>
          <span className="w-28 text-right font-semibold tabular-nums">
            {formatFinanceAmount(quote.grand_total, quote.currency, locale)}
          </span>
          <ChevronRight className="text-muted-foreground hidden size-4 sm:block" />
        </div>
      </Link>
    </li>
  );
}
