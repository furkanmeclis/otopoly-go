import { apiClient, unwrap } from "@/lib/api";
import type {
  AIConversation,
  AIConversationDetail,
  AIConversationPage,
  AIOrgSettings,
  AIOrgSettingsPut,
  AISettings,
  AISettingsPatch,
  AIStatus,
  AITestResult,
  AIUsageSummary,
} from "@/features/ai/types";

export const aiPlatformService = {
  async getSettings() {
    return unwrap<AISettings>(await apiClient.GET("/v1/platform/ai/settings"));
  },
  async patchSettings(body: AISettingsPatch) {
    return unwrap<AISettings>(
      await apiClient.PATCH("/v1/platform/ai/settings", { body }),
    );
  },
  async testConnection() {
    return unwrap<AITestResult>(
      await apiClient.POST("/v1/platform/ai/settings/test"),
    );
  },
  async getUsage(month?: string) {
    return unwrap<AIUsageSummary>(
      await apiClient.GET("/v1/platform/ai/usage", {
        params: { query: month ? { month } : {} },
      }),
    );
  },
  async getOrgSettings(uuid: string) {
    return unwrap<AIOrgSettings>(
      await apiClient.GET("/v1/platform/ai/organizations/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
  async putOrgSettings(uuid: string, body: AIOrgSettingsPut) {
    return unwrap<AIOrgSettings>(
      await apiClient.PUT("/v1/platform/ai/organizations/{uuid}", {
        params: { path: { uuid } },
        body,
      }),
    );
  },
};

export const aiTenantService = {
  async getStatus() {
    return unwrap<AIStatus>(await apiClient.GET("/v1/tenant/ai/status"), {
      silent: true,
    });
  },
  async listConversations(query: { q?: string; limit?: number } = {}) {
    return unwrap<AIConversationPage>(
      await apiClient.GET("/v1/tenant/ai/conversations", {
        params: {
          query: {
            ...(query.q ? { q: query.q } : {}),
            limit: query.limit ?? 50,
          },
        },
      }),
    );
  },
  async createConversation(title?: string) {
    return unwrap<AIConversation>(
      await apiClient.POST("/v1/tenant/ai/conversations", {
        body: title ? { title } : {},
      }),
    );
  },
  async getConversation(uuid: string) {
    return unwrap<AIConversationDetail>(
      await apiClient.GET("/v1/tenant/ai/conversations/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
  async renameConversation(uuid: string, title: string) {
    return unwrap<AIConversation>(
      await apiClient.PATCH("/v1/tenant/ai/conversations/{uuid}", {
        params: { path: { uuid } },
        body: { title },
      }),
    );
  },
  async deleteConversation(uuid: string) {
    return unwrap<{ deleted: boolean }>(
      await apiClient.DELETE("/v1/tenant/ai/conversations/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
};
