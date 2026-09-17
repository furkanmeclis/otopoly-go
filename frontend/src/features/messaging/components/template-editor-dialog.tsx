"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

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
  useUpsertTemplate,
} from "@/features/messaging/hooks/use-messaging";
import type { MessageTemplate } from "@/features/messaging/types";
import { EVENT_VARIABLES } from "@/features/messaging/types";

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

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Populate from existing template when dialog opens
  useEffect(() => {
    if (open) {
      setSubject(existing?.subject ?? "");
      setBody(existing?.body ?? "");
    }
  }, [open, existing]);

  const variables = EVENT_VARIABLES[eventType] ?? [];

  function insertVariable(varName: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const snippet = `{{${varName}}}`;
    const newBody = body.slice(0, start) + snippet + body.slice(end);
    setBody(newBody);
    // Restore focus and move cursor after inserted snippet
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

  const isSaving = upsertMutation.isPending || patchMutation.isPending;
  const channelLabel = channel === "whatsapp" ? "WhatsApp" : "SMS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {eventLabel} — {channelLabel} Mesaj Şablonu
          </DialogTitle>
          <DialogDescription>
            Müşterilere gönderilecek mesaj şablonunu düzenleyin. Dinamik
            değerleri otomatik doldurmak için değişken chip'lerine tıklayın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
              rows={6}
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
