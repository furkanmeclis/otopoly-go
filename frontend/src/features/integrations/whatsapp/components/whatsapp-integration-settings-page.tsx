"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PageHeader } from "@/components/layout/page-header";
import { permissions } from "@/config/permissions";
import { WhatsAppPlatformSessionCard } from "@/features/integrations/whatsapp/components/whatsapp-platform-session-card";
import { WhatsAppSettingsForm } from "@/features/integrations/whatsapp/components/whatsapp-settings-form";
import { WhatsAppTemplatesCard } from "@/features/integrations/whatsapp/components/whatsapp-templates-card";
import { WhatsAppTestSendCard } from "@/features/integrations/whatsapp/components/whatsapp-test-send-card";
import { WhatsAppWebhookCard } from "@/features/integrations/whatsapp/components/whatsapp-webhook-card";
import type { WhatsAppSettingsFormValues } from "@/features/integrations/whatsapp/schemas/whatsapp-settings-form";
import { whatsappIntegrationService } from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { appToast } from "@/providers/toast-provider";

const SETTINGS_KEY = ["platform", "integrations", "whatsapp"] as const;
const TEMPLATES_KEY = [...SETTINGS_KEY, "templates"] as const;

/** Only non-empty secrets are sent; an empty field keeps the stored value. */
function toPatch(values: WhatsAppSettingsFormValues) {
  const secret = (value?: string) => value?.trim() || undefined;
  return {
    provider: values.provider,
    app_id: values.app_id,
    waba_id: values.waba_id,
    phone_number_id: values.phone_number_id,
    api_version: values.api_version,
    display_phone: values.display_phone,
    ...(secret(values.access_token)
      ? { access_token: secret(values.access_token) }
      : {}),
    ...(secret(values.app_secret)
      ? { app_secret: secret(values.app_secret) }
      : {}),
    ...(secret(values.webhook_verify_token)
      ? { webhook_verify_token: secret(values.webhook_verify_token) }
      : {}),
  };
}

export function WhatsAppIntegrationSettingsPage() {
  const { t } = useLocale();
  const { can } = usePermission();
  const queryClient = useQueryClient();
  const canRead = can(permissions.integrations.whatsapp.read);
  const canWrite = can(permissions.integrations.whatsapp.write);
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped after each save: remounts the form so typed secrets are cleared
  // (QR polling also refreshes settings and must not reset the form).
  const [formVersion, setFormVersion] = useState(0);

  const settingsQuery = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => whatsappIntegrationService.getSettings(),
    enabled: canRead,
    // Same flow as the tenant session card: poll while the QR is pending.
    refetchInterval: (q) =>
      q.state.data?.whatsmeow_status === "qr_pending" ? 1500 : false,
  });

  const templatesQuery = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => whatsappIntegrationService.listTemplates(),
    enabled: canRead,
  });

  const saveMutation = useMutation({
    mutationFn: (values: WhatsAppSettingsFormValues) =>
      whatsappIntegrationService.patchSettings(toPatch(values)),
    onMutate: () => setServerError(null),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      setFormVersion((v) => v + 1);
      appToast.success(t("integrations.whatsapp.toast.saved"));
    },
    onError: (error) => {
      if (isApiError(error)) {
        // Shown inline; the global API error handler already toasts it.
        setServerError(error.message);
        return;
      }
      appToast.error(t("integrations.whatsapp.toast.failed"));
    },
  });

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("integrations.whatsapp.forbidden")}
      />
    );
  }

  const settings = settingsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<MessageCircle className="size-7" />}
        title={t("integrations.whatsapp.title")}
        description={t("integrations.whatsapp.description")}
      />

      {settingsQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {settingsQuery.isError ? (
        <ErrorState
          title={t("integrations.whatsapp.error.title")}
          description={t("integrations.whatsapp.error.description")}
          retryLabel={t("common.retry")}
          onRetry={() => void settingsQuery.refetch()}
        />
      ) : null}

      {settings ? (
        <>
          <WhatsAppSettingsForm
            key={formVersion}
            settings={settings}
            canWrite={canWrite}
            isSaving={saveMutation.isPending}
            serverError={serverError}
            onSubmit={async (values) => {
              try {
                await saveMutation.mutateAsync(values);
              } catch {
                // Surfaced via serverError + toast.
              }
            }}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <WhatsAppWebhookCard settings={settings} />
            <WhatsAppTestSendCard
              provider={settings.provider}
              templates={templatesQuery.data ?? []}
              canWrite={canWrite}
            />
            <WhatsAppPlatformSessionCard
              settings={settings}
              queryKey={SETTINGS_KEY}
              canWrite={canWrite}
            />
          </div>

          <WhatsAppTemplatesCard
            templates={templatesQuery.data ?? []}
            isLoading={templatesQuery.isLoading}
            isError={templatesQuery.isError}
            onRetry={() => void templatesQuery.refetch()}
            queryKey={TEMPLATES_KEY}
            canWrite={canWrite}
          />
        </>
      ) : null}
    </div>
  );
}
