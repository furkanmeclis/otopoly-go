"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Eye, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { routes } from "@/config/routes";
import {
  useDailySummarySettings,
  usePreviewDailySummary,
  useSaveDailySummary,
  useSendTestDailySummary,
} from "@/features/messaging/hooks/use-daily-summary";
import type { DailySummarySettings } from "@/features/messaging/services/daily-summary.service";
import { isApiError } from "@/lib/api";
import { date as formatDate } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/**
 * End-of-day WhatsApp summary (vehicles per service, revenue, unpaid, cash
 * balances) sent at the closing time to the selected authorised members.
 * Owner-only: the summary contains financial figures.
 */
export function DailySummaryCard() {
  const { t } = useLocale();
  const query = useDailySummarySettings();
  const data = query.data;

  if (!data) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4" />
            {t("messaging.daily_summary.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p
            className={
              query.isError
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {query.isError
              ? t("messaging.daily_summary.errors.generic")
              : t("common.loading")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Re-mount the form whenever the saved settings change so its local state
  // starts from the server values.
  const savedKey = [
    data.enabled,
    data.send_time,
    [...data.recipient_user_uuids].sort().join(","),
  ].join("|");
  return <DailySummaryForm key={savedKey} data={data} />;
}

function DailySummaryForm({ data }: { data: DailySummarySettings }) {
  const { t, locale } = useLocale();
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");
  const save = useSaveDailySummary();
  const preview = usePreviewDailySummary();
  const sendTest = useSendTestDailySummary();

  const [enabled, setEnabled] = useState(data.enabled);
  const [sendTime, setSendTime] = useState(data.send_time);
  const [recipients, setRecipients] = useState<string[]>(
    data.recipient_user_uuids,
  );
  const [previewText, setPreviewText] = useState<string | null>(null);

  const dirty =
    data.enabled !== enabled ||
    data.send_time !== sendTime ||
    [...data.recipient_user_uuids].sort().join() !==
      [...recipients].sort().join();

  const members = data.members;
  const selectedWithoutPhone = members.filter(
    (m) => recipients.includes(m.uuid) && !m.has_phone,
  );

  const errorMessage = (err: unknown) => {
    if (isApiError(err)) {
      const key = `messaging.daily_summary.errors.${err.code}`;
      const translated = t(key);
      if (translated !== key) return translated;
      return err.message;
    }
    return t("messaging.daily_summary.errors.generic");
  };

  async function onSave() {
    try {
      await save.mutateAsync({
        enabled,
        send_time: sendTime,
        recipient_user_uuids: recipients,
      });
      toast.success(t("messaging.daily_summary.saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onPreview() {
    try {
      const res = await preview.mutateAsync();
      setPreviewText(res.message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onSendTest() {
    try {
      const res = await sendTest.mutateAsync();
      toast.success(
        t("messaging.daily_summary.test_sent", { count: res.sent }),
      );
      if (res.skipped.length > 0) {
        toast.warning(
          t("messaging.daily_summary.test_skipped", {
            names: res.skipped.join(", "),
          }),
        );
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" />
          {t("messaging.daily_summary.title")}
        </CardTitle>
        <CardDescription>
          {t("messaging.daily_summary.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <>
          {!data.whatsapp_connected ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t("messaging.daily_summary.not_connected")}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="daily-summary-enabled">
                  {t("messaging.daily_summary.enabled")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {data.last_sent_on
                    ? t("messaging.daily_summary.last_sent", {
                        date: formatDate(
                          data.last_sent_on,
                          "dd.MM.yyyy",
                          locale,
                        ),
                      })
                    : t("messaging.daily_summary.never_sent")}
                </p>
              </div>
              <Switch
                id="daily-summary-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <Label htmlFor="daily-summary-time">
                {t("messaging.daily_summary.send_time")}
              </Label>
              <Input
                id="daily-summary-time"
                type="time"
                step={60}
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value.slice(0, 5))}
                className="w-32"
              />
              <p className="text-muted-foreground text-xs">
                {t("messaging.daily_summary.send_time_hint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <Label>{t("messaging.daily_summary.recipients")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("messaging.daily_summary.recipients_hint")}
              </p>
            </div>
            <ul className="divide-y rounded-lg border">
              {members.map((m) => {
                const checked = recipients.includes(m.uuid);
                return (
                  <li key={m.uuid}>
                    <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setRecipients((prev) =>
                            v
                              ? [...prev, m.uuid]
                              : prev.filter((id) => id !== m.uuid),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.name || m.email}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {m.email}
                        </span>
                      </span>
                      <Badge variant="secondary" className="shrink-0">
                        {m.role === "owner"
                          ? t("messaging.daily_summary.role_owner")
                          : t("messaging.daily_summary.role_staff")}
                      </Badge>
                      {!m.has_phone ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400"
                        >
                          {t("messaging.daily_summary.no_phone")}
                        </Badge>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            {selectedWithoutPhone.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t("messaging.daily_summary.no_phone_hint", {
                  names: selectedWithoutPhone
                    .map((m) => m.name || m.email)
                    .join(", "),
                })}{" "}
                <Link
                  href={routes.tenant.profile.root(slug)}
                  className="underline"
                >
                  {t("messaging.daily_summary.no_phone_link")}
                </Link>
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={preview.isPending}
              onClick={() => void onPreview()}
            >
              <Eye className="size-4" />
              {t("messaging.daily_summary.preview")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                sendTest.isPending ||
                dirty ||
                data.recipient_user_uuids.length === 0
              }
              title={
                dirty ? t("messaging.daily_summary.save_first") : undefined
              }
              onClick={() => void onSendTest()}
            >
              <Send className="size-4" />
              {t("messaging.daily_summary.send_test")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => void onSave()}
            >
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </>
      </CardContent>

      <Dialog
        open={previewText !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewText(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("messaging.daily_summary.preview_title")}
            </DialogTitle>
            <DialogDescription>
              {t("messaging.daily_summary.preview_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-[#e7ffdb] p-3 text-sm whitespace-pre-wrap text-neutral-900 shadow-sm dark:bg-[#005c4b] dark:text-neutral-50">
            <WhatsAppText text={previewText ?? ""} />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Minimal WhatsApp markup: *bold* and _italic_. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <strong key={i}>{part.slice(1, -1)}</strong>;
        }
        if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
