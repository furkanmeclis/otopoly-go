"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSimulateMessaging } from "@/features/messaging/hooks/use-messaging";
import { useTemplateMutations } from "@/features/messaging/hooks/use-message-templates";
import {
  renderTemplate,
  typeKey,
  unknownPlaceholders,
} from "@/features/messaging/lib/render";
import type {
  MessageTemplateEntry,
  MessageTemplateType,
  TemplateChannel,
  TemplateLocale,
} from "@/features/messaging/services/templates.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type Draft = { subject: string; body: string; isActive: boolean };

const LOCALES: TemplateLocale[] = ["tr", "en"];

type Props = {
  type: MessageTemplateType | null;
  initialChannel?: TemplateChannel;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MessageTemplateEditor(props: Props) {
  return (
    <Dialog open={Boolean(props.type)} onOpenChange={props.onOpenChange}>
      {props.type ? (
        <EditorBody key={props.type.type} {...props} type={props.type} />
      ) : null}
    </Dialog>
  );
}

function entryFor(
  type: MessageTemplateType,
  channel: TemplateChannel,
  locale: TemplateLocale,
): MessageTemplateEntry | undefined {
  return type.templates.find(
    (e) => e.channel === channel && e.locale === locale,
  );
}

function EditorBody({
  type,
  initialChannel,
  canWrite,
  onOpenChange,
}: Props & { type: MessageTemplateType }) {
  const { t, locale: uiLocale } = useLocale();
  const { save, reset } = useTemplateMutations();
  const simulate = useSimulateMessaging();
  const [channel, setChannel] = useState<TemplateChannel>(
    initialChannel && type.channels.includes(initialChannel)
      ? initialChannel
      : type.channels[0],
  );
  const [locale, setLocale] = useState<TemplateLocale>(
    uiLocale === "en" ? "en" : "tr",
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [testPhone, setTestPhone] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const entry = entryFor(type, channel, locale);
  const draftKey = `${channel}:${locale}`;
  const draft: Draft = drafts[draftKey] ?? {
    subject: entry?.subject ?? "",
    body: entry?.body ?? "",
    isActive: entry?.is_active ?? true,
  };
  const setDraft = (patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [draftKey]: { ...draft, ...patch } }));

  const allowed = useMemo(
    () => type.placeholders.map((p) => p.key),
    [type.placeholders],
  );
  const samples = useMemo(
    () =>
      Object.fromEntries(
        type.placeholders.map((p) => [
          p.key,
          locale === "en" ? p.sample_en : p.sample_tr,
        ]),
      ),
    [type.placeholders, locale],
  );
  const unknown = unknownPlaceholders(allowed, draft.subject, draft.body);
  const previewTitle = renderTemplate(draft.subject, samples);
  const previewBody = renderTemplate(draft.body, samples);
  const phoneChannel = channel === "whatsapp" || channel === "sms";
  const dirty =
    !entry ||
    draft.subject !== entry.subject ||
    draft.body !== entry.body ||
    draft.isActive !== entry.is_active;
  const key = { eventType: type.type, channel, locale };
  const pending = save.isPending || reset.isPending;

  function insert(placeholder: string) {
    const el = bodyRef.current;
    const snippet = `{{${placeholder}}}`;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    setDraft({
      body: draft.body.slice(0, start) + snippet + draft.body.slice(end),
    });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    await save.mutateAsync({
      key,
      body: {
        subject: draft.subject,
        body: draft.body,
        is_active: draft.isActive,
      },
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[draftKey];
      return next;
    });
  }

  async function handleReset() {
    if (!window.confirm(t("messaging.editor.reset_confirm"))) return;
    await reset.mutateAsync(key);
    setDrafts((d) => {
      const next = { ...d };
      delete next[draftKey];
      return next;
    });
  }

  const typeLabel = t(`messaging.types.${typeKey(type.type)}`);

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>
          {t("messaging.editor.title", { type: typeLabel })}
        </DialogTitle>
        <DialogDescription>
          {t("messaging.editor.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={channel}
          onValueChange={(v) => setChannel(v as TemplateChannel)}
        >
          <TabsList className="flex-wrap">
            {type.channels.map((ch) => {
              const e = entryFor(type, ch, locale);
              return (
                <TabsTrigger key={ch} value={ch} className="gap-1.5">
                  {t(`messaging.channel.${ch}`)}
                  {e && !e.is_active ? (
                    <span className="bg-muted-foreground size-1.5 rounded-full" />
                  ) : e?.is_custom ? (
                    <span className="bg-primary size-1.5 rounded-full" />
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <Tabs
          value={locale}
          onValueChange={(v) => setLocale(v as TemplateLocale)}
        >
          <TabsList>
            {LOCALES.map((l) => (
              <TabsTrigger key={l} value={l}>
                {t(`messaging.locale.${l}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="tpl-active">{t("messaging.editor.active")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("messaging.editor.active_hint")}
              </p>
            </div>
            <Switch
              id="tpl-active"
              checked={draft.isActive}
              disabled={!canWrite}
              onCheckedChange={(v) => setDraft({ isActive: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject">{t("messaging.editor.subject")}</Label>
            <Input
              id="tpl-subject"
              value={draft.subject}
              maxLength={200}
              disabled={!canWrite}
              onChange={(e) => setDraft({ subject: e.target.value })}
            />
            {phoneChannel ? (
              <p className="text-muted-foreground text-xs">
                {t("messaging.editor.subject_hint")}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">{t("messaging.editor.body")}</Label>
            <Textarea
              id="tpl-body"
              ref={bodyRef}
              value={draft.body}
              rows={9}
              maxLength={4000}
              disabled={!canWrite}
              onChange={(e) => setDraft({ body: e.target.value })}
              className="resize-y font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {t("messaging.editor.placeholders")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("messaging.editor.placeholders_hint")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {type.placeholders.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => insert(p.key)}
                  title={locale === "en" ? p.sample_en : p.sample_tr}
                  className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <Badge
                    variant="outline"
                    className="hover:bg-accent cursor-pointer font-mono text-[11px]"
                  >
                    {`{{${p.key}}}`}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          {unknown.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                {t("messaging.editor.unknown", {
                  list: unknown.map((k) => `{{${k}}}`).join(", "),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <Label>{t("messaging.editor.preview")}</Label>
          <div className="bg-muted/40 rounded-2xl border p-4">
            <div
              className={cn(
                "mx-auto max-w-[320px] rounded-2xl p-3 shadow-sm",
                phoneChannel ? "bg-emerald-600/10" : "bg-background",
                !draft.isActive && "opacity-50",
              )}
            >
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                {t(`messaging.channel.${channel}`)} ·{" "}
                {t(`messaging.locale.${locale}`)}
              </p>
              {!phoneChannel && previewTitle ? (
                <p className="mb-1 text-sm font-semibold break-words">
                  {previewTitle}
                </p>
              ) : null}
              <div className="bg-background rounded-xl px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {previewBody || t("messaging.editor.preview_empty")}
              </div>
            </div>
          </div>

          {canWrite && channel === "whatsapp" && locale === "tr" ? (
            <div className="space-y-1.5">
              <Label htmlFor="tpl-test-phone">
                {t("messaging.editor.test_phone")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="tpl-test-phone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="05xxxxxxxxx"
                  inputMode="tel"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={simulate.isPending || !testPhone.trim() || dirty}
                  onClick={() =>
                    simulate.mutate({
                      mode: "event",
                      event_type: type.type,
                      channel: "whatsapp",
                      phone: testPhone.trim(),
                      vars: samples,
                    })
                  }
                  aria-label={t("messaging.editor.test_send")}
                >
                  {simulate.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("messaging.editor.test_hint")}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <div>
          {canWrite && entry?.is_custom ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => void handleReset().catch(() => undefined)}
            >
              <RotateCcw className="size-4" />
              {t("messaging.editor.reset")}
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("messaging.editor.cancel")}
          </Button>
          {canWrite ? (
            <Button
              disabled={
                pending || !dirty || !draft.body.trim() || unknown.length > 0
              }
              onClick={() => void handleSave().catch(() => undefined)}
            >
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("messaging.editor.save")}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
