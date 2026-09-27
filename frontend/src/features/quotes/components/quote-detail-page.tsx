"use client";

import {
  ArrowLeft,
  BellRing,
  CalendarClock,
  Check,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  Hammer,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { ConvertQuoteDialog } from "@/features/quotes/components/convert-quote-dialog";
import {
  copyShareLink,
  ReminderPicker,
  remindersBody,
  SendQuoteDialog,
} from "@/features/quotes/components/send-quote-dialog";
import {
  useQuote,
  useQuoteMutations,
  useQuotesAccess,
} from "@/features/quotes/hooks/use-quotes";
import { QUOTE_STEPS, quoteStatusTone } from "@/features/quotes/lib/quote-ui";
import { quotesService } from "@/features/quotes/services/quotes.service";
import type {
  QuoteDetail,
  QuoteStatus,
  ReminderKind,
} from "@/features/quotes/types";
import { cn } from "@/lib/utils";
import { date, datetime, relativeDatetime } from "@/lib/utils/format";
import { localToday } from "@/lib/utils/local-date";
import { deliveryErrorText } from "@/features/quotes/lib/delivery-error";
import { LinkedTodosCard } from "@/features/todos";
import { useLocale } from "@/providers/locale-provider";

function daysLeft(validUntil: string): number {
  const a = new Date(`${localToday()}T00:00:00`);
  const b = new Date(`${validUntil}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function QuoteDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useQuotesAccess();
  const query = useQuote(uuid);
  const m = useQuoteMutations();
  const [sendOpen, setSendOpen] = useState(
    () => searchParams.get("send") === "1",
  );
  const [convertOpen, setConvertOpen] = useState(false);
  const [decision, setDecision] = useState<
    null | "accepted" | "rejected" | "cancelled"
  >(null);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // "Save & send" lands here with ?send=1: drop the flag from the URL.
  useEffect(() => {
    if (searchParams.get("send") === "1") {
      router.replace(routes.tenant.quotes.detail(slug, uuid));
    }
  }, [searchParams, router, slug, uuid]);

  if (query.isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (!query.data) {
    return (
      <EmptyState
        title={t("quotes.not_found")}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={routes.tenant.quotes.root(slug)}>
              {t("quotes.title")}
            </Link>
          </Button>
        }
      />
    );
  }
  const q = query.data;
  const money = (v: string) => formatFinanceAmount(v, q.currency, locale);
  const shared = q.status !== "draft";
  const days = q.valid_until ? daysLeft(q.valid_until) : null;
  const canConvert = access.canConvert && q.can_convert;
  const open =
    q.status === "draft" || q.status === "sent" || q.status === "viewed";

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      await quotesService.downloadPdf(q.uuid, q.number);
    } catch {
      setPdfBusy(false);
      return;
    }
    setPdfBusy(false);
  };

  const primary = (() => {
    if (q.job_uuid) {
      return (
        <Button asChild>
          <Link href={routes.tenant.operations.detail(slug, q.job_uuid)}>
            <Hammer className="size-4" />
            {t("quotes.actions.open_job")}
          </Link>
        </Button>
      );
    }
    if (q.status === "draft" && access.canWrite) {
      return (
        <Button onClick={() => setSendOpen(true)}>
          <Send className="size-4" />
          {t("quotes.actions.send")}
        </Button>
      );
    }
    if (canConvert) {
      return (
        <Button onClick={() => setConvertOpen(true)}>
          <Hammer className="size-4" />
          {t("quotes.actions.convert")}
        </Button>
      );
    }
    return null;
  })();

  return (
    <div className="flex w-full flex-col gap-4 pb-24 md:pb-6">
      <Link
        href={routes.tenant.quotes.root(slug)}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("quotes.title")}
      </Link>

      <header className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display font-mono text-xl font-semibold">
                {q.number}
              </h1>
              <StatusChip
                label={t(`quotes.status.${q.status}`)}
                tone={quoteStatusTone(q.status)}
              />
              {q.view_count > 0 ? (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <Eye className="size-3.5" />
                  {q.view_count}
                </span>
              ) : null}
            </div>
            <p className="text-sm">
              <Link
                href={routes.tenant.customers.detail(slug, q.customer_uuid)}
                className="font-medium hover:underline"
              >
                {q.customer_name}
              </Link>
              {q.customer_phone ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {q.customer_phone}
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {q.vehicle_plate ? (
                <PlateBadge plate={q.vehicle_plate} size="sm" />
              ) : null}
              {q.vehicle_label ? (
                <span className="text-muted-foreground">{q.vehicle_label}</span>
              ) : null}
              {q.lead_uuid ? (
                <Link
                  href={routes.tenant.leads.detail(slug, q.lead_uuid)}
                  className="text-primary hover:underline"
                >
                  {t("quotes.from_lead")}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">
              {t("quotes.fields.grand_total")}
            </p>
            <p className="text-primary text-2xl font-semibold tabular-nums">
              {money(q.grand_total)}
            </p>
            {q.valid_until ? (
              <p
                className={cn(
                  "flex items-center justify-end gap-1 text-xs",
                  open && days !== null && days < 0
                    ? "text-destructive"
                    : open && days !== null && days <= 3
                      ? "text-amber-600"
                      : "text-muted-foreground",
                )}
              >
                <CalendarClock className="size-3.5" />
                {date(q.valid_until, "dd.MM.yyyy", locale)}
                {open && days !== null
                  ? ` · ${days < 0 ? t("quotes.valid.past") : days === 0 ? t("quotes.valid.today") : t("quotes.valid.days", { days })}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>

        <QuoteStepper status={q.status} />
        {q.status === "rejected" || q.status === "accepted" ? (
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm",
              q.status === "accepted"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
            )}
          >
            {q.status === "accepted" ? (
              <Check className="mt-0.5 size-4 shrink-0" />
            ) : (
              <X className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {t(`quotes.decision_banner.${q.status}`)}
                {(q.status === "accepted" ? q.accepted_at : q.rejected_at)
                  ? ` · ${datetime((q.status === "accepted" ? q.accepted_at : q.rejected_at) as string, "dd.MM.yyyy HH:mm", locale)}`
                  : ""}
              </p>
              {q.decision_channel === "public" || q.decision_note ? (
                <p className="opacity-80">
                  {q.decision_channel === "public"
                    ? t("quotes.decided_by_customer")
                    : null}
                  {q.decision_note ? ` “${q.decision_note}”` : ""}
                </p>
              ) : null}
              {q.status === "accepted" && !q.job_uuid && canConvert ? (
                <p className="mt-0.5 opacity-80">
                  {t("quotes.decision_banner.convert_hint")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {primary}
          <SecondaryActions
            q={q}
            canWrite={access.canWrite}
            canConvert={canConvert}
            pdfBusy={pdfBusy}
            shared={shared}
            slug={slug}
            onSend={() => setSendOpen(true)}
            onConvert={() => setConvertOpen(true)}
            onPdf={() => void downloadPdf()}
            onDecision={setDecision}
            onDuplicate={() =>
              m.duplicate.mutate(q.uuid, {
                onSuccess: (d) =>
                  router.push(routes.tenant.quotes.edit(slug, d.uuid)),
              })
            }
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="bg-card overflow-hidden rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground bg-muted/40 text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium">
                  {t("quotes.fields.description")}
                </th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">
                  {t("quotes.fields.quantity")}
                </th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">
                  {t("quotes.fields.unit_price")}
                </th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">
                  {t("quotes.fields.discount")}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t("quotes.fields.total")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.lines.map((l) => {
                const disc =
                  Number(l.line_discount) + Number(l.quote_discount_share);
                return (
                  <tr key={l.uuid}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{l.description}</p>
                      <p className="text-muted-foreground text-xs sm:hidden">
                        {Number(l.quantity)} {l.unit} × {money(l.unit_price)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t(`quotes.line_type.${l.line_type}`)} · %
                        {Number(l.vat_rate)} {t("quotes.fields.vat")}
                      </p>
                    </td>
                    <td className="hidden px-2 py-2.5 text-right tabular-nums sm:table-cell">
                      {Number(l.quantity)} {l.unit}
                    </td>
                    <td className="hidden px-2 py-2.5 text-right tabular-nums sm:table-cell">
                      {money(l.unit_price)}
                    </td>
                    <td className="text-muted-foreground hidden px-2 py-2.5 text-right tabular-nums md:table-cell">
                      {disc > 0 ? `-${money(disc.toFixed(2))}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {money(l.line_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <dl className="ml-auto max-w-xs space-y-1 border-t p-4 text-sm">
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
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>{t("quotes.fields.grand_total")}</dt>
              <dd className="tabular-nums">{money(q.grand_total)}</dd>
            </div>
          </dl>
          {q.notes || q.terms ? (
            <div className="grid gap-3 border-t p-4 text-sm md:grid-cols-2">
              {q.notes ? (
                <div>
                  <p className="text-muted-foreground mb-1 text-xs">
                    {t("quotes.fields.notes")}
                  </p>
                  <p className="whitespace-pre-wrap">{q.notes}</p>
                </div>
              ) : null}
              {q.terms ? (
                <div>
                  <p className="text-muted-foreground mb-1 text-xs">
                    {t("quotes.fields.terms")}
                  </p>
                  <p className="whitespace-pre-wrap">{q.terms}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="bg-card rounded-2xl border">
            <h2 className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold">
              {t("quotes.deliveries.title")}
              {access.canWrite && q.can_send && q.status !== "draft" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setSendOpen(true)}
                >
                  <Send className="size-3.5" />
                  {t("quotes.actions.resend")}
                </Button>
              ) : null}
            </h2>
            {q.deliveries.length === 0 ? (
              <p className="text-muted-foreground px-4 py-4 text-sm">
                {t("quotes.deliveries.empty")}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {q.deliveries.map((d) => (
                  <li
                    key={d.uuid}
                    className="flex items-start gap-2 px-4 py-2.5"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        d.status === "sent"
                          ? "bg-emerald-500"
                          : d.status === "failed"
                            ? "bg-destructive"
                            : "bg-amber-500",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p>
                        {t(`quotes.deliveries.status.${d.status}`)} ·{" "}
                        {d.channel}
                        {d.recipient ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {d.recipient}
                          </span>
                        ) : null}
                      </p>
                      {d.error ? (
                        <p
                          className="text-destructive truncate text-xs"
                          title={d.error}
                        >
                          {deliveryErrorText(d.error, t)}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground text-xs">
                        {datetime(
                          d.last_attempt_at ?? d.created_at,
                          "dd.MM HH:mm",
                          locale,
                        )}{" "}
                        ·{" "}
                        {t("quotes.deliveries.attempts", {
                          count: d.attempt_count,
                        })}
                      </p>
                    </div>
                    {d.status === "failed" &&
                    access.canWrite &&
                    (q.status === "sent" || q.status === "viewed") ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={m.retry.isPending}
                        onClick={() =>
                          m.retry.mutate({ uuid: q.uuid, deliveryUuid: d.uuid })
                        }
                        aria-label={t("quotes.actions.retry")}
                        title={t("quotes.actions.retry")}
                      >
                        <RotateCw className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card rounded-2xl border">
            <h2 className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold">
              <span className="flex items-center gap-1.5">
                <BellRing className="size-4" />
                {t("quotes.reminders.title")}
              </span>
              {access.canWrite && open ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setRemindersOpen(true)}
                >
                  {t("quotes.reminders.edit")}
                </Button>
              ) : null}
            </h2>
            {q.reminders.length === 0 ? (
              <p className="text-muted-foreground px-4 py-4 text-sm">
                {t("quotes.reminders.empty")}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {q.reminders.map((r) => (
                  <li
                    key={r.uuid}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span
                      className={cn(
                        r.status === "cancelled" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {t(`quotes.reminders.kind.${r.kind}`)}
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        · {datetime(r.fire_at, "dd.MM HH:mm", locale)}
                      </span>
                    </span>
                    <span
                      className="text-muted-foreground text-xs"
                      title={deliveryErrorText(r.error, t)}
                    >
                      {t(`quotes.reminders.status.${r.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card rounded-2xl border">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">
              {t("quotes.history")}
            </h2>
            <ol className="space-y-3 p-4 text-sm">
              {q.events.map((e) => (
                <li key={e.uuid} className="flex gap-2">
                  <span className="bg-primary/60 mt-1.5 size-2 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p>
                      {e.kind === "status_changed"
                        ? t("quotes.events.status_changed", {
                            to: t(`quotes.status.${e.to_status}`),
                          })
                        : t(`quotes.events.${e.kind}`)}
                      {e.channel === "public" ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t("quotes.events.by_customer")}
                        </span>
                      ) : e.channel === "system" ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t("quotes.events.by_system")}
                        </span>
                      ) : null}
                    </p>
                    {e.body &&
                    e.kind !== "converted" &&
                    e.kind !== "reminders_set" ? (
                      <p className="text-muted-foreground text-xs">{e.body}</p>
                    ) : null}
                    <p
                      className="text-muted-foreground text-xs"
                      title={datetime(
                        e.created_at,
                        "dd.MM.yyyy HH:mm:ss",
                        locale,
                      )}
                    >
                      {relativeDatetime(e.created_at, locale)}
                      {e.actor_name ? ` · ${e.actor_name}` : ""}
                      {e.ip ? ` · ${e.ip}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <LinkedTodosCard
            slug={slug}
            quote={q.uuid}
            defaults={{
              quote: {
                uuid: q.uuid,
                label: `${q.number} · ${q.customer_name}`,
              },
              customer: { uuid: q.customer_uuid, label: q.customer_name },
              ...(q.lead_uuid
                ? { lead: { uuid: q.lead_uuid, label: q.customer_name } }
                : {}),
            }}
          />
        </aside>
      </div>

      {/* Mobile action bar */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t p-3 backdrop-blur md:hidden">
        <div className="flex-1 [&>*]:w-full">{primary}</div>
        <SecondaryActions
          q={q}
          canWrite={access.canWrite}
          canConvert={canConvert}
          pdfBusy={pdfBusy}
          shared={shared}
          slug={slug}
          onSend={() => setSendOpen(true)}
          onConvert={() => setConvertOpen(true)}
          onPdf={() => void downloadPdf()}
          onDecision={setDecision}
          onDuplicate={() =>
            m.duplicate.mutate(q.uuid, {
              onSuccess: (d) =>
                router.push(routes.tenant.quotes.edit(slug, d.uuid)),
            })
          }
          compact
        />
      </div>

      <SendQuoteDialog
        slug={slug}
        quote={q}
        open={sendOpen && q.can_send}
        onOpenChange={setSendOpen}
      />
      <ConvertQuoteDialog
        slug={slug}
        quote={q}
        open={convertOpen}
        onOpenChange={setConvertOpen}
      />
      <DecisionDialog
        status={decision}
        onClose={() => setDecision(null)}
        pending={m.setStatus.isPending}
        onConfirm={(status, note) =>
          m.setStatus.mutate(
            { uuid: q.uuid, status, note },
            { onSuccess: () => setDecision(null) },
          )
        }
      />
      <RemindersDialog
        quote={q}
        open={remindersOpen}
        onOpenChange={setRemindersOpen}
      />
    </div>
  );
}

function SecondaryActions({
  q,
  canWrite,
  canConvert,
  pdfBusy,
  shared,
  slug,
  onSend,
  onConvert,
  onPdf,
  onDecision,
  onDuplicate,
  compact,
}: {
  q: QuoteDetail;
  canWrite: boolean;
  canConvert: boolean;
  pdfBusy: boolean;
  shared: boolean;
  slug: string;
  onSend: () => void;
  onConvert: () => void;
  onPdf: () => void;
  onDecision: (s: "accepted" | "rejected" | "cancelled") => void;
  onDuplicate: () => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const allowed = q.allowed_statuses;
  return (
    <>
      {!compact ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onPdf}
            disabled={pdfBusy}
          >
            <Download className="size-4" />
            {t("quotes.actions.pdf")}
          </Button>
          {shared ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void copyShareLink(q.share_url, t("quotes.toast.link_copied"))
              }
            >
              <Copy className="size-4" />
              {t("quotes.actions.copy_link")}
            </Button>
          ) : null}
          {canWrite && q.can_edit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.tenant.quotes.edit(slug, q.uuid)}>
                <Pencil className="size-4" />
                {t("quotes.actions.edit")}
              </Link>
            </Button>
          ) : null}
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? "icon" : "sm"}
            aria-label={t("quotes.more_actions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {compact ? (
            <>
              <DropdownMenuItem onSelect={onPdf}>
                <Download className="size-4" />
                {t("quotes.actions.pdf")}
              </DropdownMenuItem>
              {shared ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void copyShareLink(
                      q.share_url,
                      t("quotes.toast.link_copied"),
                    )
                  }
                >
                  <Copy className="size-4" />
                  {t("quotes.actions.copy_link")}
                </DropdownMenuItem>
              ) : null}
              {canWrite && q.can_edit ? (
                <DropdownMenuItem asChild>
                  <Link href={routes.tenant.quotes.edit(slug, q.uuid)}>
                    <Pencil className="size-4" />
                    {t("quotes.actions.edit")}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {shared ? (
            <DropdownMenuItem asChild>
              <a href={q.share_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                {t("quotes.actions.open_link")}
              </a>
            </DropdownMenuItem>
          ) : null}
          {canWrite && q.can_send && q.status !== "draft" ? (
            <DropdownMenuItem onSelect={onSend}>
              <Send className="size-4" />
              {t("quotes.actions.resend")}
            </DropdownMenuItem>
          ) : null}
          {canConvert && q.status === "draft" ? null : canConvert ? (
            <DropdownMenuItem onSelect={onConvert}>
              <Hammer className="size-4" />
              {t("quotes.actions.convert")}
            </DropdownMenuItem>
          ) : null}
          {canWrite && allowed.length > 0 ? <DropdownMenuSeparator /> : null}
          {canWrite && allowed.includes("accepted") ? (
            <DropdownMenuItem onSelect={() => onDecision("accepted")}>
              <Check className="size-4" />
              {t("quotes.actions.mark_accepted")}
            </DropdownMenuItem>
          ) : null}
          {canWrite && allowed.includes("rejected") ? (
            <DropdownMenuItem onSelect={() => onDecision("rejected")}>
              <X className="size-4" />
              {t("quotes.actions.mark_rejected")}
            </DropdownMenuItem>
          ) : null}
          {canWrite && allowed.includes("cancelled") ? (
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onDecision("cancelled")}
            >
              <X className="size-4" />
              {t("quotes.actions.cancel")}
            </DropdownMenuItem>
          ) : null}
          {canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDuplicate}>
                <CopyPlus className="size-4" />
                {t("quotes.actions.duplicate")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function QuoteStepper({ status }: { status: QuoteStatus }) {
  const { t } = useLocale();
  const terminalBad =
    status === "rejected" || status === "expired" || status === "cancelled";
  const idx = QUOTE_STEPS.indexOf(status);
  return (
    <div className="space-y-1">
      <ol className="grid grid-cols-4 gap-1">
        {QUOTE_STEPS.map((step, i) => {
          const done = !terminalBad && idx >= i;
          return (
            <li
              key={step}
              className="flex flex-col items-center gap-1 text-center"
            >
              <span
                className={cn(
                  "h-1.5 w-full rounded-full",
                  done
                    ? step === "accepted"
                      ? "bg-emerald-500"
                      : "bg-primary"
                    : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "text-[11px] sm:text-xs",
                  done ? "text-primary font-medium" : "text-muted-foreground",
                )}
              >
                {t(`quotes.status.${step}`)}
              </span>
            </li>
          );
        })}
      </ol>
      {terminalBad ? (
        <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-1.5 text-center text-xs font-medium">
          {t(`quotes.terminal.${status}`)}
        </p>
      ) : null}
    </div>
  );
}

function DecisionDialog({
  status,
  onClose,
  onConfirm,
  pending,
}: {
  status: null | "accepted" | "rejected" | "cancelled";
  onClose: () => void;
  onConfirm: (status: string, note: string) => void;
  pending: boolean;
}) {
  return (
    <Dialog open={status !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        {status ? (
          <DecisionBody
            status={status}
            onClose={onClose}
            onConfirm={onConfirm}
            pending={pending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionBody({
  status,
  onClose,
  onConfirm,
  pending,
}: {
  status: "accepted" | "rejected" | "cancelled";
  onClose: () => void;
  onConfirm: (status: string, note: string) => void;
  pending: boolean;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`quotes.decision.${status}`)}</DialogTitle>
      </DialogHeader>
      <Textarea
        value={note}
        rows={2}
        maxLength={1000}
        placeholder={t("quotes.decision.note")}
        onChange={(e) => setNote(e.target.value)}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant={status === "accepted" ? "default" : "destructive"}
          disabled={pending}
          onClick={() => onConfirm(status, note.trim())}
        >
          {t("common.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}

function RemindersDialog({
  quote,
  open,
  onOpenChange,
}: {
  quote: QuoteDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open ? (
          <RemindersBody quote={quote} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RemindersBody({
  quote,
  onClose,
}: {
  quote: QuoteDetail;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { setReminders } = useQuoteMutations();
  const openReminders = quote.reminders.filter(
    (r) => r.status === "pending" || r.status === "scheduled",
  );
  const [kinds, setKinds] = useState<ReminderKind[]>(() =>
    openReminders.map((r) => r.kind),
  );
  const [customDate, setCustomDate] = useState(() => {
    const custom = openReminders.find((r) => r.kind === "custom");
    return custom ? custom.fire_at.slice(0, 10) : localToday();
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("quotes.reminders.title")}</DialogTitle>
      </DialogHeader>
      <ReminderPicker
        quote={quote}
        kinds={kinds}
        onKinds={setKinds}
        customDate={customDate}
        onCustomDate={setCustomDate}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={setReminders.isPending}
          onClick={() =>
            setReminders.mutate(
              { uuid: quote.uuid, reminders: remindersBody(kinds, customDate) },
              { onSuccess: onClose },
            )
          }
        >
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
