"use client";

import { Check, Copy, Webhook } from "lucide-react";
import { useState } from "react";

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
import type { WhatsAppIntegrationSettings } from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

const SUBSCRIBED_FIELDS = ["messages", "message_template_status_update"];

export function WhatsAppWebhookCard({
  settings,
}: {
  settings: WhatsAppIntegrationSettings;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(settings.webhook_url);
      setCopied(true);
      appToast.success(t("integrations.whatsapp.webhook.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      appToast.error(t("integrations.whatsapp.webhook.copy_failed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="size-4" />
          {t("integrations.whatsapp.webhook.title")}
        </CardTitle>
        <CardDescription>
          {t("integrations.whatsapp.webhook.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <p className="font-medium">
            {t("integrations.whatsapp.webhook.url")}
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={settings.webhook_url}
              className="font-mono text-xs"
              aria-label={t("integrations.whatsapp.webhook.url")}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyUrl()}
              aria-label={t("integrations.whatsapp.webhook.copy")}
              title={t("integrations.whatsapp.webhook.copy")}
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <ol className="text-muted-foreground list-decimal space-y-2 pl-5">
          <li>{t("integrations.whatsapp.webhook.step_callback")}</li>
          <li>
            {t("integrations.whatsapp.webhook.step_verify_token")}{" "}
            <Badge
              variant={
                settings.webhook_verify_token_configured ? "success" : "warning"
              }
            >
              {settings.webhook_verify_token_configured
                ? t("integrations.whatsapp.cloud.configured")
                : t("integrations.whatsapp.cloud.not_configured")}
            </Badge>
          </li>
          <li>
            {t("integrations.whatsapp.webhook.step_fields")}{" "}
            {SUBSCRIBED_FIELDS.map((field) => (
              <code
                key={field}
                className="bg-muted text-foreground mr-1 rounded px-1.5 py-0.5 font-mono text-xs"
              >
                {field}
              </code>
            ))}
          </li>
          <li>{t("integrations.whatsapp.webhook.step_app_secret")}</li>
        </ol>
      </CardContent>
    </Card>
  );
}
