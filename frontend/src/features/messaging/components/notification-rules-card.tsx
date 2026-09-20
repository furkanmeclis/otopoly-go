"use client";

import { useState } from "react";
import { Bell, Pencil, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useMessageTemplates,
  useNotificationRules,
  useSimulateMessaging,
  useToggleRule,
} from "@/features/messaging/hooks/use-messaging";
import { TemplateEditorDialog } from "@/features/messaging/components/template-editor-dialog";
import type { RuleList } from "@/features/messaging/types";
import { SAMPLE_VARS, renderTemplatePreview } from "@/features/messaging/types";

interface EditorTarget {
  eventType: string;
  eventLabel: string;
  channel: string;
}

export function NotificationRulesCard() {
  const rulesQuery = useNotificationRules();
  const templatesQuery = useMessageTemplates();
  const toggleRule = useToggleRule();
  const simulateMutation = useSimulateMessaging();

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [simPhone, setSimPhone] = useState("");

  const ruleLists: RuleList[] = rulesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  function getTemplate(eventType: string, channel: string) {
    return templates.find(
      (t) => t.event_type === eventType && t.channel === channel,
    );
  }

  function handleToggle(
    eventType: string,
    channel: string,
    currentEnabled: boolean,
  ) {
    toggleRule.mutate({ eventType, channel, enabled: !currentEnabled });
  }

  async function handleLifecycleSimulate() {
    const phone = simPhone.trim();
    if (!phone) return;
    await simulateMutation.mutateAsync({
      mode: "job_lifecycle",
      channel: "whatsapp",
      phone,
      vars: SAMPLE_VARS,
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5" />
            <CardTitle>Bildirim Kuralları</CardTitle>
          </div>
          <CardDescription>
            Hangi olaylar için hangi kanaldan bildirim gönderileceğini yönetin
            ve mesaj şablonlarını düzenleyin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">İşlem yaşam döngüsü simülasyonu</p>
              <p className="text-xs text-muted-foreground">
                Oluşturma → sözleşme → hazır → teslim → ödeme mesajlarını sırayla
                test olarak gönderir.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={simPhone}
                onChange={(e) => setSimPhone(e.target.value)}
                placeholder="05xxxxxxxxx"
                className="w-40"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  simulateMutation.isPending || !simPhone.trim()
                }
                onClick={handleLifecycleSimulate}
              >
                <Play className="mr-1.5 size-3.5" />
                Simüle et
              </Button>
            </div>
          </div>

          {rulesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor...</p>
          ) : null}
          {rulesQuery.isError ? (
            <p className="text-sm text-destructive">
              Kurallar yüklenemedi.
            </p>
          ) : null}

          {ruleLists.length === 0 && !rulesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Henüz bildirim kuralı tanımlanmamış.
            </p>
          ) : null}

          <div className="divide-y">
            {ruleLists.map((rl) => {
              const tpl = getTemplate(rl.event_type, "whatsapp");
              const preview = tpl
                ? renderTemplatePreview(tpl.body, SAMPLE_VARS)
                : "";

              return (
                <div
                  key={rl.event_type}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">{rl.event_label}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {rl.rules.map((rule) => {
                        const isWhatsApp = rule.channel === "whatsapp";
                        const isSms = rule.channel === "sms";

                        if (isSms) {
                          return (
                            <TooltipProvider key={`${rl.event_type}-sms`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 opacity-50">
                                    <Switch disabled checked={false} />
                                    <Badge variant="outline" className="text-xs">
                                      SMS
                                    </Badge>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>Yakında</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        }

                        if (isWhatsApp) {
                          return (
                            <div
                              key={`${rl.event_type}-wa`}
                              className="flex items-center gap-1.5"
                            >
                              <Switch
                                checked={rule.enabled}
                                onCheckedChange={() =>
                                  handleToggle(
                                    rl.event_type,
                                    rule.channel,
                                    rule.enabled,
                                  )
                                }
                                disabled={toggleRule.isPending}
                              />
                              <Badge
                                variant={rule.enabled ? "default" : "outline"}
                                className="text-xs"
                              >
                                WhatsApp
                              </Badge>
                            </div>
                          );
                        }

                        return null;
                      })}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditorTarget({
                            eventType: rl.event_type,
                            eventLabel: rl.event_label,
                            channel: "whatsapp",
                          })
                        }
                      >
                        <Pencil className="mr-1.5 size-3.5" />
                        Mesaj Düzenle
                      </Button>
                    </div>
                  </div>

                  {preview ? (
                    <p className="line-clamp-2 pl-6 text-xs text-muted-foreground whitespace-pre-wrap">
                      {preview}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {editorTarget ? (
        <TemplateEditorDialog
          key={`${editorTarget.eventType}-${getTemplate(editorTarget.eventType, editorTarget.channel)?.uuid ?? "new"}`}
          open={Boolean(editorTarget)}
          onOpenChange={(open) => {
            if (!open) setEditorTarget(null);
          }}
          eventType={editorTarget.eventType}
          eventLabel={editorTarget.eventLabel}
          channel={editorTarget.channel}
          existing={getTemplate(editorTarget.eventType, editorTarget.channel)}
        />
      ) : null}
    </>
  );
}
