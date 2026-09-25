"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  MessageCircle,
  Send,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useQuoteMutations } from "@/features/quotes/hooks/use-quotes";
import { quotesService } from "@/features/quotes/services/quotes.service";
import type {
  QuoteDelivery,
  QuoteDetail,
  QuoteReminderInput,
  ReminderKind,
} from "@/features/quotes/types";
import { date } from "@/lib/utils/format";
import { localToday } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

const PRESETS: ReminderKind[] = ["before_3d", "before_1d", "last_day"];

export async function copyShareLink(url: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(okMessage);
  } catch {
    window.prompt("", url);
  }
}

/** Reminder picker shared by the send dialog and the reminders card. */
export function ReminderPicker({
  quote,
  kinds,
  onKinds,
  customDate,
  onCustomDate,
}: {
  quote: QuoteDetail;
  kinds: ReminderKind[];
  onKinds: (k: ReminderKind[]) => void;
  customDate: string;
  onCustomDate: (d: string) => void;
}) {
  const { t } = useLocale();
  const hasValid = Boolean(quote.valid_until);
  const toggle = (k: ReminderKind, on: boolean) =>
    onKinds(on ? [...kinds, k] : kinds.filter((x) => x !== k));
  return (
    <div className="space-y-2">
      {!hasValid ? (
        <p className="text-muted-foreground text-xs">
          {t("quotes.reminders.need_valid_until")}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={kinds.includes(k)}
              disabled={!hasValid}
              onCheckedChange={(v) => toggle(k, v === true)}
            />
            {t(`quotes.reminders.kind.${k}`)}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={kinds.includes("custom")}
            onCheckedChange={(v) => toggle("custom", v === true)}
          />
          {t("quotes.reminders.kind.custom")}
        </label>
      </div>
      {kinds.includes("custom") ? (
        <DatePicker value={customDate} onChange={onCustomDate} />
      ) : null}
    </div>
  );
}

export function remindersBody(
  kinds: ReminderKind[],
  customDate: string,
): QuoteReminderInput[] {
  return kinds
    .filter((k) => k !== "custom" || customDate)
    .map((k) => (k === "custom" ? { kind: k, date: customDate } : { kind: k }));
}

function SendQuoteDialogBody({
  quote,
  onOpenChange,
}: {
  quote: QuoteDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const { send } = useQuoteMutations();
  const [kinds, setKinds] = useState<ReminderKind[]>(() =>
    quote.valid_until ? ["before_1d"] : [],
  );
  const [customDate, setCustomDate] = useState(() => localToday());
  const [result, setResult] = useState<QuoteDelivery | null>(null);
  const noPhone = !quote.customer_phone;

  const submit = () =>
    send.mutate(
      {
        uuid: quote.uuid,
        body: {
          channel: "whatsapp",
          reminders:
            kinds.length > 0 ? remindersBody(kinds, customDate) : undefined,
        },
      },
      {
        onSuccess: (res) => {
          if (res.delivery.status === "sent") onOpenChange(false);
          else setResult(res.delivery);
        },
      },
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("quotes.send.title", { number: quote.number })}
        </DialogTitle>
        <DialogDescription>{t("quotes.send.description")}</DialogDescription>
      </DialogHeader>

      {result ? (
        <div className="space-y-3">
          <div className="bg-destructive/10 text-destructive flex gap-2 rounded-lg p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{t("quotes.send.failed")}</p>
              <p className="text-xs opacity-80">
                {result.error === "not configured"
                  ? t("quotes.send.not_configured")
                  : result.error}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm">
            {t("quotes.send.fallback")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() =>
                void copyShareLink(
                  quote.share_url,
                  t("quotes.toast.link_copied"),
                )
              }
            >
              <Copy className="size-4" />
              {t("quotes.actions.copy_link")}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void quotesService.downloadPdf(quote.uuid, quote.number)
              }
            >
              <Download className="size-4" />
              {t("quotes.actions.pdf")}
            </Button>
            {quote.customer_phone ? (
              <Button asChild variant="outline" className="sm:col-span-2">
                <a
                  href={`https://wa.me/${quote.customer_phone.replace(/\D/g, "").replace(/^0/, "90")}?text=${encodeURIComponent(
                    t("quotes.send.wa_text", {
                      name: quote.customer_name,
                      number: quote.number,
                      total: formatFinanceAmount(
                        quote.grand_total,
                        quote.currency,
                        locale,
                      ),
                      link: quote.share_url,
                    }),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="size-4" />
                  {t("quotes.send.open_whatsapp")}
                </a>
              </Button>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>
              <Check className="size-4" />
              {t("common.close")}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="bg-muted/40 grid grid-cols-2 gap-2 rounded-lg p-3 text-sm">
            <dt className="text-muted-foreground">
              {t("quotes.fields.customer")}
            </dt>
            <dd className="text-right font-medium">{quote.customer_name}</dd>
            <dt className="text-muted-foreground">
              {t("quotes.send.recipient")}
            </dt>
            <dd className="text-right">{quote.customer_phone || "—"}</dd>
            <dt className="text-muted-foreground">
              {t("quotes.fields.grand_total")}
            </dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatFinanceAmount(quote.grand_total, quote.currency, locale)}
            </dd>
            <dt className="text-muted-foreground">
              {t("quotes.fields.valid_until")}
            </dt>
            <dd className="text-right">
              {quote.valid_until
                ? date(quote.valid_until, "dd.MM.yyyy", locale)
                : "—"}
            </dd>
          </dl>
          {noPhone ? (
            <p className="flex gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              {t("quotes.send.no_phone")}
            </p>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("quotes.reminders.title")}</p>
            <ReminderPicker
              quote={quote}
              kinds={kinds}
              onKinds={setKinds}
              customDate={customDate}
              onCustomDate={setCustomDate}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={send.isPending} onClick={submit}>
              <Send className="size-4" />
              {send.isPending
                ? t("quotes.send.sending")
                : t("quotes.send.submit")}
            </Button>
          </DialogFooter>
        </div>
      )}
    </>
  );
}

export function SendQuoteDialog(props: {
  quote: QuoteDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        {props.open ? <SendQuoteDialogBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
