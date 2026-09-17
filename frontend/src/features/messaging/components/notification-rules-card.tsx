"use client";

import { useState } from "react";
import { Bell, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  useToggleRule,
} from "@/features/messaging/hooks/use-messaging";
import { TemplateEditorDialog } from "@/features/messaging/components/template-editor-dialog";
import type { RuleList } from "@/features/messaging/types";

interface EditorTarget {
  eventType: string;
  eventLabel: string;
  channel: string;
}

export function NotificationRulesCard() {
  const rulesQuery = useNotificationRules();
  const templatesQuery = useMessageTemplates();
  const toggleRule = useToggleRule();

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);

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
        <CardContent>
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
            {ruleLists.map((rl) => (
              <div
                key={rl.event_type}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Left: label */}
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{rl.event_label}</span>
                </div>

                {/* Right: channel toggles + edit button */}
                <div className="flex flex-wrap items-center gap-3">
                  {rl.rules.map((rule) => {
                    const isWhatsApp = rule.channel === "whatsapp";
                    const isSms = rule.channel === "sms";

                    if (isSms) {
                      return (
                        <TooltipProvider key={rule.uuid}>
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
                          key={rule.uuid}
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

                  {/* Edit template button — show for whatsapp channel */}
                  {rl.rules.some((r) => r.channel === "whatsapp") ? (
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
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {editorTarget ? (
        <TemplateEditorDialog
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
