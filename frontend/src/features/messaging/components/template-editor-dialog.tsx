"use client";

import { useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  usePatchTemplate,
  useSimulateMessaging,
  useUpsertTemplate,
} from "@/features/messaging/hooks/use-messaging";
import type { MessageTemplate } from "@/features/messaging/types";
import {
  DEFAULT_TEMPLATES,
  EVENT_VARIABLES,
  SAMPLE_VARS,
  renderTemplatePreview,
} from "@/features/messaging/types";

interface TemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: string;
  eventLabel: string;
  channel: string;
  existing?: MessageTemplate | null;
}

export function TemplateEditorDialog({
  open,
  onOpenChange,
  eventType,
  eventLabel,
  channel,
  existing,
}: TemplateEditorDialogProps) {
  const upsertMutation = useUpsertTemplate();
  const patchMutation = usePatchTemplate();
  const simulateMutation = useSimulateMessaging();

  const defaults = DEFAULT_TEMPLATES[eventType];
  const [subject, setSubject] = useState(
    () => existing?.subject ?? defaults?.subject ?? "",
  );
  const [body, setBody] = useState(
    () => existing?.body ?? defaults?.body ?? "",
  );
  const [testPhone, setTestPhone] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const variables = EVENT_VARIABLES[eventType] ?? [];
  const preview = renderTemplatePreview(body, SAMPLE_VARS);

  function insertVariable(varName: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const snippet = `{{${varName}}}`;
    const newBody = body.slice(0, start) + snippet + body.slice(end);
    setBody(newBody);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    if (existing) {
      await patchMutation.mutateAsync({
        uuid: existing.uuid,
        body: { subject, body, variables },
      });
    } else {
      await upsertMutation.mutateAsync({
        event_type: eventType,
        channel,
        locale: "tr",
        subject,
        body,
        variables,
      });
    }
    onOpenChange(false);
  }

  async function handleTestSend() {
    const phone = testPhone.trim();
    if (!phone) return;
    // Persist first so simulate uses the latest body when template exists.
    if (existing) {
      await patchMutation.mutateAsync({
        uuid: existing.uuid,
        body: { subject, body, variables },
      });
    } else {
      await upsertMutation.mutateAsync({
        event_type: eventType,
        channel,
        locale: "tr",
        subject,
        body,
        variables,
      });
    }
    await simulateMutation.mutateAsync({
      mode: "event",
      event_type: eventType,
      channel: "whatsapp",
      phone,
      vars: SAMPLE_VARS,
    });
  }

  const isSaving = upsertMutation.isPending || patchMutation.isPending;
  const isTesting = simulateMutation.isPending;
  const channelLabel = channel === "whatsapp" ? "WhatsApp" : "SMS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {eventLabel} — {channelLabel} Mesaj Şablonu
          </DialogTitle>
          <DialogDescription>
            Değişken chip’lerine tıklayarak mesaja ekleyin. Sağdaki önizleme
            örnek verilerle anlık güncellenir.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="msg-subject">Başlık</Label>
              <Input
                id="msg-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Bildirim başlığı..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="msg-body">Mesaj</Label>
              <Textarea
                id="msg-body"
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Mesaj içeriği..."
                className="resize-none font-mono text-sm"
              />
            </div>

            {variables.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Mesaja eklemek için değişkene tıklayın:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <Badge
                      key={v}
                      variant="outline"
                      className="cursor-pointer hover:bg-accent"
                      onClick={() => insertVariable(v)}
                    >
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <Label>Canlı önizleme</Label>
            <div className="rounded-2xl border bg-muted/40 p-4">
              <div className="mx-auto max-w-[280px] rounded-2xl bg-emerald-600/10 p-3 shadow-sm">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  WhatsApp · örnek
                </p>
                <div className="whitespace-pre-wrap rounded-xl bg-background px-3 py-2 text-sm leading-relaxed">
                  {preview || "Mesaj önizlemesi burada görünür."}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="test-phone">Test telefonu</Label>
              <div className="flex gap-2">
                <Input
                  id="test-phone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="05xxxxxxxxx"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isTesting || isSaving || !testPhone.trim() || !body.trim()}
                  onClick={handleTestSend}
                >
                  {isTesting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Kaydedip örnek değişkenlerle WhatsApp’a test mesajı gönderir.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !subject.trim() || !body.trim()}
          >
            {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
