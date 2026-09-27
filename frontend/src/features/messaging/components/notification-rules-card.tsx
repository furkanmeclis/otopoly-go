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
  useNotificationRules,
  useSimulateMessaging,
  useToggleRule,
} from "@/features/messaging/hooks/use-messaging";
import { useTemplateCatalog } from "@/features/messaging/hooks/use-message-templates";
import { MessageTemplateEditor } from "@/features/messaging/components/message-template-editor";
import { renderTemplate } from "@/features/messaging/lib/render";
import type { RuleList } from "@/features/messaging/types";
import { SAMPLE_VARS } from "@/features/messaging/types";
import { permissions } from "@/config/permissions";
import { usePermission } from "@/providers/permission-provider";
import { useLocale } from "@/providers/locale-provider";

export function NotificationRulesCard() {
  const { t } = useLocale();
  const rulesQuery = useNotificationRules();
  const catalogQuery = useTemplateCatalog();
  const { hasPermission } = usePermission();
  const canWrite = hasPermission(permissions.messaging.write);
  const toggleRule = useToggleRule();
  const simulateMutation = useSimulateMessaging();

  const [editorType, setEditorType] = useState<string | null>(null);
  const [simPhone, setSimPhone] = useState("");

  const ruleLists: RuleList[] = rulesQuery.data ?? [];
  const catalog = catalogQuery.data ?? [];

  function previewFor(eventType: string) {
    const type = catalog.find((x) => x.type === eventType);
    const entry = type?.templates.find(
      (e) => e.channel === "whatsapp" && e.locale === "tr",
    );
    if (!type || !entry) return "";
    const samples = Object.fromEntries(
      type.placeholders.map((p) => [p.key, p.sample_tr]),
    );
    return renderTemplate(entry.body, samples);
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
            <CardTitle>{t("messaging.rules.title")}</CardTitle>
          </div>
          <CardDescription>{t("messaging.rules.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/30 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">
                {t("messaging.rules.simulate_title")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("messaging.rules.simulate_body")}
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
                disabled={simulateMutation.isPending || !simPhone.trim()}
                onClick={handleLifecycleSimulate}
              >
                <Play className="mr-1.5 size-3.5" />
                {t("messaging.rules.simulate")}
              </Button>
            </div>
          </div>

          {rulesQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">
              {t("messaging.common.loading")}
            </p>
          ) : null}
          {rulesQuery.isError ? (
            <p className="text-destructive text-sm">
              {t("messaging.rules.load_failed")}
            </p>
          ) : null}

          {ruleLists.length === 0 && !rulesQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">
              {t("messaging.rules.empty")}
            </p>
          ) : null}

          <div className="divide-y">
            {ruleLists.map((rl) => {
              const preview = previewFor(rl.event_type);

              return (
                <div
                  key={rl.event_type}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="text-muted-foreground size-4 shrink-0" />
                      <span className="text-sm font-medium">
                        {rl.event_label}
                      </span>
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
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      SMS
                                    </Badge>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("messaging.rules.soon")}
                                </TooltipContent>
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
                        onClick={() => setEditorType(rl.event_type)}
                      >
                        <Pencil className="mr-1.5 size-3.5" />
                        {t("messaging.rules.edit_message")}
                      </Button>
                    </div>
                  </div>

                  {preview ? (
                    <p className="text-muted-foreground line-clamp-2 pl-6 text-xs whitespace-pre-wrap">
                      {preview}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <MessageTemplateEditor
        type={catalog.find((x) => x.type === editorType) ?? null}
        initialChannel="whatsapp"
        canWrite={canWrite}
        onOpenChange={(open) => {
          if (!open) setEditorType(null);
        }}
      />
    </>
  );
}
