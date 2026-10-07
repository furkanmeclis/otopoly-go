"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  whatsappIntegrationService,
  type PlatformWhatsAppTestResult,
  type WhatsAppCloudTemplate,
  type WhatsAppProvider,
} from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import {
  isSendErrorCode,
  sendErrorLabel,
} from "@/features/messaging/lib/send-errors";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

/** Select value for "no catalog key" (hello_world / plain test line). */
const DEFAULT_TEMPLATE = "__default__";

type TestSendError = { code: string; message: string };

export function WhatsAppTestSendCard({
  provider,
  templates,
  canWrite,
}: {
  provider: WhatsAppProvider;
  templates: WhatsAppCloudTemplate[];
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const [phone, setPhone] = useState("");
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE);
  const [result, setResult] = useState<PlatformWhatsAppTestResult | null>(null);
  const [error, setError] = useState<TestSendError | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      whatsappIntegrationService.sendTest({
        phone: phone.trim(),
        ...(templateKey !== DEFAULT_TEMPLATE
          ? { template_key: templateKey }
          : {}),
      }),
    onMutate: () => {
      setResult(null);
      setError(null);
    },
    onSuccess: (res) => setResult(res),
    onError: (err) => {
      if (isApiError(err)) {
        setError({ code: err.code, message: err.message });
        return;
      }
      setError({ code: "", message: t("integrations.whatsapp.test.failed") });
    },
  });

  const disabled = !canWrite || provider === "none";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4" />
          {t("integrations.whatsapp.test.title")}
        </CardTitle>
        <CardDescription>
          {provider === "none"
            ? t("integrations.whatsapp.test.no_provider")
            : t("integrations.whatsapp.test.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!phone.trim()) return;
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="wa-test-phone">
              {t("integrations.whatsapp.test.phone")}
            </Label>
            <Input
              id="wa-test-phone"
              inputMode="tel"
              autoComplete="off"
              placeholder="905xxxxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={disabled}
            />
            <p className="text-muted-foreground text-xs">
              {t("integrations.whatsapp.test.phone_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-test-template">
              {t("integrations.whatsapp.test.template")}
            </Label>
            <Select
              value={templateKey}
              onValueChange={setTemplateKey}
              disabled={disabled}
            >
              <SelectTrigger id="wa-test-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_TEMPLATE}>
                  {provider === "cloud"
                    ? t("integrations.whatsapp.test.hello_world")
                    : t("integrations.whatsapp.test.plain_line")}
                </SelectItem>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.key} value={tpl.key}>
                    {tpl.key} · {tpl.effective_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={disabled || mutation.isPending || !phone.trim()}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {t("integrations.whatsapp.test.send")}
          </Button>

          {result ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">
                  {t("integrations.whatsapp.test.sent")}
                </p>
                <p className="text-muted-foreground text-xs break-all">
                  {t("integrations.whatsapp.test.sent_detail", {
                    sender: t(
                      result.sender_kind === "platform_cloud"
                        ? "integrations.whatsapp.provider.cloud"
                        : "integrations.whatsapp.provider.whatsmeow",
                    ),
                    template: result.template_name || "—",
                    reference: result.provider_reference || "—",
                  })}
                </p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">
                  {isSendErrorCode(error.code)
                    ? sendErrorLabel(t, error.code)
                    : t("integrations.whatsapp.test.failed")}
                </p>
                <p className="text-xs break-all opacity-80">
                  {error.code ? `${error.code} · ` : ""}
                  {error.message}
                </p>
              </div>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
