import type { components } from "@/generated/api";
import { apiClient, unwrap } from "@/lib/api";

export type WhatsAppIntegrationSettings =
  components["schemas"]["WhatsAppIntegrationSettings"];
export type WhatsAppSettingsPatch =
  components["schemas"]["PatchWhatsAppIntegrationSettingsRequest"];
export type WhatsAppProvider = WhatsAppIntegrationSettings["provider"];
export type WhatsAppCloudTemplate = components["schemas"]["WhatsAppTemplate"];
export type WhatsAppTemplateStatus = WhatsAppCloudTemplate["status"];
export type WhatsAppTemplateSubmit =
  components["schemas"]["WhatsAppTemplateSubmit"];
export type PlatformWhatsAppTestRequest =
  components["schemas"]["PlatformWhatsAppTestRequest"];
export type PlatformWhatsAppTestResult =
  components["schemas"]["PlatformWhatsAppTestResult"];

type TemplateList = components["schemas"]["WhatsAppTemplateList"];

export const whatsappIntegrationService = {
  async getSettings() {
    return unwrap<WhatsAppIntegrationSettings>(
      await apiClient.GET("/v1/platform/integrations/whatsapp"),
    );
  },

  async patchSettings(body: WhatsAppSettingsPatch) {
    return unwrap<WhatsAppIntegrationSettings>(
      await apiClient.PATCH("/v1/platform/integrations/whatsapp", { body }),
    );
  },

  async sendTest(body: PlatformWhatsAppTestRequest) {
    return unwrap<PlatformWhatsAppTestResult>(
      await apiClient.POST("/v1/platform/integrations/whatsapp/test", {
        body,
      }),
    );
  },

  async connectSession() {
    return unwrap<WhatsAppIntegrationSettings>(
      await apiClient.POST(
        "/v1/platform/integrations/whatsapp/session/connect",
      ),
    );
  },

  async disconnectSession() {
    return unwrap<WhatsAppIntegrationSettings>(
      await apiClient.DELETE("/v1/platform/integrations/whatsapp/session"),
    );
  },

  async listTemplates() {
    const data = await unwrap<TemplateList>(
      await apiClient.GET("/v1/platform/integrations/whatsapp/templates"),
    );
    return data.items;
  },

  async submitTemplates(keys?: string[]) {
    return unwrap<WhatsAppTemplateSubmit>(
      await apiClient.POST(
        "/v1/platform/integrations/whatsapp/templates/submit",
        { body: keys && keys.length > 0 ? { keys } : {} },
      ),
    );
  },

  async syncTemplates() {
    const data = await unwrap<TemplateList>(
      await apiClient.POST("/v1/platform/integrations/whatsapp/templates/sync"),
    );
    return data.items;
  },

  async setOverride(key: string, overrideName: string | null) {
    return unwrap<WhatsAppCloudTemplate>(
      await apiClient.PATCH(
        "/v1/platform/integrations/whatsapp/templates/{key}",
        {
          params: { path: { key } },
          body: { override_name: overrideName },
        },
      ),
    );
  },
};
