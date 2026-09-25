"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileText, Phone, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiConfig } from "@/config/api";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { publicQuotesService } from "@/features/quotes/services/quotes.service";
import type { PublicQuote } from "@/features/quotes/types";
import { date, datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Read-only customer view of a shared quote with accept / reject. */
export function PublicQuotePage({ token }: { token: string }) {
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const key = ["public", "quote", token];
  const query = useQuery({
    queryKey: key,
    queryFn: () => publicQuotesService.get(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [confirm, setConfirm] = useState<null | "accept" | "reject">(null);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (accept: boolean) =>
      publicQuotesService.decide(token, accept, note),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setConfirm(null);
    },
  });

  if (query.isLoading) {
    return (
      <Shell>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </Shell>
    );
  }
  if (!query.data) {
    return (
      <Shell>
        <div className="bg-card rounded-2xl border p-10 text-center">
          <FileText className="text-muted-foreground mx-auto mb-3 size-10" />
          <h1 className="text-lg font-semibold">
            {t("quotes.public.not_found")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("quotes.public.not_found_hint")}
          </p>
        </div>
      </Shell>
    );
  }
  const q: PublicQuote = query.data;
  const money = (v: string) => formatFinanceAmount(v, q.currency, locale);
  const logo = q.organization_logo_url
    ? `${apiConfig.baseUrl.replace(/\/$/, "")}${q.organization_logo_url}`
    : null;

  return (
    <Shell>
      <header
        className="bg-card flex items-center gap-3 rounded-2xl border-t-4 p-4 shadow-xs"
        style={{ borderTopColor: q.primary_color }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            className="size-12 rounded-lg object-contain"
          />
        ) : (
          <span
            className="grid size-12 place-items-center rounded-lg text-lg font-bold text-white"
            style={{ background: q.primary_color }}
          >
            {q.organization_name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{q.organization_name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {q.organization_address}
          </p>
        </div>
        {q.organization_phone ? (
          <Button
            asChild
            variant="outline"
            size="icon"
            aria-label={t("quotes.public.call")}
          >
            <a href={`tel:${q.organization_phone}`}>
              <Phone className="size-4" />
            </a>
          </Button>
        ) : null}
      </header>

      <section className="bg-card space-y-4 rounded-2xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              {t("quotes.public.quote")}
            </p>
            <h1 className="font-mono text-lg font-semibold">{q.number}</h1>
            <p className="text-muted-foreground text-xs">
              {t("quotes.public.issued")}:{" "}
              {date(q.issued_at, "dd.MM.yyyy", locale)}
              {q.valid_until
                ? ` · ${t("quotes.public.valid_until")}: ${date(q.valid_until, "dd.MM.yyyy", locale)}`
                : ""}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-sm font-medium">{q.customer_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs sm:justify-end">
              {q.vehicle_plate ? (
                <PlateBadge plate={q.vehicle_plate} size="sm" />
              ) : null}
              <span className="text-muted-foreground">{q.vehicle_label}</span>
            </div>
          </div>
        </div>

        <ul className="divide-y rounded-xl border">
          {q.lines.map((l, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{l.description}</p>
                <p className="text-muted-foreground text-xs">
                  {Number(l.quantity)} {l.unit} × {money(l.unit_price)}
                  {Number(l.discount) > 0
                    ? ` · ${t("quotes.fields.discount")} -${money(l.discount)}`
                    : ""}
                </p>
              </div>
              <span className="shrink-0 font-medium tabular-nums">
                {money(l.line_total)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {t("quotes.fields.subtotal")}
            </dt>
            <dd className="tabular-nums">{money(q.subtotal)}</dd>
          </div>
          {Number(q.discount_total) > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {t("quotes.fields.discount_total")}
              </dt>
              <dd className="tabular-nums">-{money(q.discount_total)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {q.prices_include_vat
                ? t("quotes.fields.vat_included")
                : t("quotes.fields.vat_total")}
            </dt>
            <dd className="tabular-nums">{money(q.vat_total)}</dd>
          </div>
          <div className="flex justify-between border-t pt-2 text-lg font-semibold">
            <dt>{t("quotes.fields.grand_total")}</dt>
            <dd className="tabular-nums" style={{ color: q.primary_color }}>
              {money(q.grand_total)}
            </dd>
          </div>
        </dl>

        {q.notes ? (
          <p className="text-sm whitespace-pre-wrap">{q.notes}</p>
        ) : null}
        {q.terms ? (
          <p className="text-muted-foreground border-t pt-3 text-xs whitespace-pre-wrap">
            {q.terms}
          </p>
        ) : null}
      </section>

      {q.status === "accepted" || q.status === "rejected" ? (
        <div
          className={
            q.status === "accepted"
              ? "flex items-center gap-2 rounded-2xl bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300"
              : "bg-destructive/10 text-destructive flex items-center gap-2 rounded-2xl p-4"
          }
        >
          {q.status === "accepted" ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <XCircle className="size-5" />
          )}
          <div>
            <p className="font-medium">{t(`quotes.public.${q.status}`)}</p>
            {q.decided_at ? (
              <p className="text-xs opacity-80">
                {datetime(q.decided_at, "dd.MM.yyyy HH:mm", locale)}
              </p>
            ) : null}
          </div>
        </div>
      ) : !q.can_decide ? (
        <p className="bg-muted text-muted-foreground rounded-2xl p-4 text-center text-sm">
          {t(
            `quotes.public.closed.${q.status === "expired" || q.status === "cancelled" ? q.status : "expired"}`,
          )}
        </p>
      ) : confirm ? (
        <section className="bg-card space-y-3 rounded-2xl border p-4">
          <p className="font-medium">
            {confirm === "accept"
              ? t("quotes.public.confirm_accept")
              : t("quotes.public.confirm_reject")}
          </p>
          <Textarea
            value={note}
            rows={2}
            maxLength={1000}
            placeholder={t("quotes.public.note")}
            onChange={(e) => setNote(e.target.value)}
          />
          {decide.isError ? (
            <p className="text-destructive text-xs">
              {t("quotes.public.error")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={confirm === "accept" ? "default" : "destructive"}
              disabled={decide.isPending}
              onClick={() => decide.mutate(confirm === "accept")}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="bg-background/95 sticky bottom-0 -mx-4 flex gap-2 border-t p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button asChild variant="outline" className="flex-1 sm:flex-none">
          <a
            href={publicQuotesService.pdfUrl(token)}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="size-4" />
            {t("quotes.public.pdf")}
          </a>
        </Button>
        {q.can_decide && !confirm ? (
          <>
            <Button
              variant="outline"
              className="flex-1 sm:ml-auto sm:flex-none"
              onClick={() => setConfirm("reject")}
            >
              <XCircle className="size-4" />
              {t("quotes.public.reject")}
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              style={{ background: q.primary_color }}
              onClick={() => setConfirm("accept")}
            >
              <CheckCircle2 className="size-4" />
              {t("quotes.public.accept")}
            </Button>
          </>
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted/30 min-h-dvh">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        {children}
      </div>
    </main>
  );
}
