"use client";

import { useMemo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import {
  AppForm,
  AppInput,
  AppRadioGroup,
  FormActions,
  FormLayout,
  FormSection,
} from "@/components/forms";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  whatsappSettingsFormSchema,
  type WhatsAppSettingsFormValues,
} from "@/features/integrations/whatsapp/schemas/whatsapp-settings-form";
import type { WhatsAppIntegrationSettings } from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import { useLocale } from "@/providers/locale-provider";

type WhatsAppSettingsFormProps = {
  settings: WhatsAppIntegrationSettings;
  canWrite: boolean;
  isSaving: boolean;
  /** Last API error message (validation errors come back as text). */
  serverError?: string | null;
  onSubmit: (values: WhatsAppSettingsFormValues) => Promise<void>;
};

export function WhatsAppSettingsForm({
  settings,
  canWrite,
  isSaving,
  serverError,
  onSubmit,
}: WhatsAppSettingsFormProps) {
  const { t } = useLocale();

  const defaultValues = useMemo<WhatsAppSettingsFormValues>(
    () => ({
      provider: settings.provider,
      app_id: settings.app_id,
      waba_id: settings.waba_id,
      phone_number_id: settings.phone_number_id,
      api_version: settings.api_version,
      display_phone: settings.display_phone,
      access_token: "",
      app_secret: "",
      webhook_verify_token: "",
    }),
    [settings],
  );

  const disabled = !canWrite || isSaving;

  const configuredBadge = (configured: boolean): ReactNode => (
    <Badge variant={configured ? "success" : "secondary"}>
      {configured
        ? t("integrations.whatsapp.cloud.configured")
        : t("integrations.whatsapp.cloud.not_configured")}
    </Badge>
  );

  const secretPlaceholder = (configured: boolean) =>
    configured
      ? t("integrations.whatsapp.cloud.secret_keep")
      : t("integrations.whatsapp.cloud.secret_placeholder");

  return (
    <AppForm
      schema={whatsappSettingsFormSchema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
    >
      {(form) => (
        <FormLayout>
          <fieldset
            disabled={disabled}
            className="m-0 min-w-0 space-y-6 border-0 p-0"
          >
            <FormSection
              title={t("integrations.whatsapp.provider.title")}
              description={t("integrations.whatsapp.provider.hint")}
            >
              <AppRadioGroup
                name="provider"
                options={[
                  {
                    value: "none",
                    label: t("integrations.whatsapp.provider.none"),
                    description: t("integrations.whatsapp.provider.none_hint"),
                  },
                  {
                    value: "whatsmeow",
                    label: t("integrations.whatsapp.provider.whatsmeow"),
                    description: t(
                      "integrations.whatsapp.provider.whatsmeow_hint",
                    ),
                  },
                  {
                    value: "cloud",
                    label: t("integrations.whatsapp.provider.cloud"),
                    description: t("integrations.whatsapp.provider.cloud_hint"),
                  },
                ]}
              />
            </FormSection>

            <FormSection
              title={t("integrations.whatsapp.cloud.title")}
              description={t("integrations.whatsapp.cloud.hint")}
              columns={2}
            >
              {form.watch("provider") === "cloud" &&
              !settings.access_token_configured ? (
                <Alert className="sm:col-span-2">
                  <AlertDescription>
                    {t("integrations.whatsapp.cloud.required_hint")}
                  </AlertDescription>
                </Alert>
              ) : null}

              <AppInput
                name="app_id"
                label={t("integrations.whatsapp.cloud.app_id")}
                description={t("integrations.whatsapp.cloud.app_id_hint")}
                autoComplete="off"
              />
              <AppInput
                name="waba_id"
                label={t("integrations.whatsapp.cloud.waba_id")}
                description={t("integrations.whatsapp.cloud.waba_id_hint")}
                autoComplete="off"
              />
              <AppInput
                name="phone_number_id"
                label={t("integrations.whatsapp.cloud.phone_number_id")}
                description={t(
                  "integrations.whatsapp.cloud.phone_number_id_hint",
                )}
                autoComplete="off"
              />
              <AppInput
                name="display_phone"
                label={t("integrations.whatsapp.cloud.display_phone")}
                description={t(
                  "integrations.whatsapp.cloud.display_phone_hint",
                )}
                autoComplete="off"
              />
              <AppInput
                name="api_version"
                label={t("integrations.whatsapp.cloud.api_version")}
                description={t("integrations.whatsapp.cloud.api_version_hint")}
                placeholder="v26.0"
                autoComplete="off"
              />
              <div className="hidden sm:block" />

              <AppInput
                name="access_token"
                type="password"
                autoComplete="new-password"
                label={t("integrations.whatsapp.cloud.access_token")}
                labelAction={configuredBadge(settings.access_token_configured)}
                description={t("integrations.whatsapp.cloud.access_token_hint")}
                placeholder={secretPlaceholder(
                  settings.access_token_configured,
                )}
                className="sm:col-span-2"
              />
              <AppInput
                name="app_secret"
                type="password"
                autoComplete="new-password"
                label={t("integrations.whatsapp.cloud.app_secret")}
                labelAction={configuredBadge(settings.app_secret_configured)}
                description={t("integrations.whatsapp.cloud.app_secret_hint")}
                placeholder={secretPlaceholder(settings.app_secret_configured)}
              />
              <AppInput
                name="webhook_verify_token"
                type="password"
                autoComplete="new-password"
                label={t("integrations.whatsapp.cloud.verify_token")}
                labelAction={configuredBadge(
                  settings.webhook_verify_token_configured,
                )}
                description={t("integrations.whatsapp.cloud.verify_token_hint")}
                placeholder={secretPlaceholder(
                  settings.webhook_verify_token_configured,
                )}
              />
            </FormSection>
          </fieldset>

          {serverError ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                {t("integrations.whatsapp.toast.validation", {
                  message: serverError,
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          {canWrite ? (
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset(defaultValues)}
                disabled={isSaving}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving
                  ? t("common.saving")
                  : t("integrations.whatsapp.save")}
              </Button>
            </FormActions>
          ) : null}
        </FormLayout>
      )}
    </AppForm>
  );
}
