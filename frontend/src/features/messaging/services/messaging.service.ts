import { platformRequest } from "@/lib/api/platform-request";
import type {
  MessageTemplate,
  NotificationRule,
  PatchTemplateInput,
  RuleList,
  SimulateInput,
  SimulateResult,
  UpsertTemplateInput,
  WhatsAppSession,
} from "@/features/messaging/types";

export const messagingService = {
  getSession() {
    return platformRequest<WhatsAppSession>(
      "GET",
      "/v1/tenant/messaging/session",
    );
  },

  connectWhatsApp() {
    return platformRequest<WhatsAppSession>(
      "POST",
      "/v1/tenant/messaging/session/connect",
    );
  },

  disconnectWhatsApp() {
    return platformRequest<{ disconnected: boolean }>(
      "DELETE",
      "/v1/tenant/messaging/session",
    );
  },

  listRules() {
    return platformRequest<RuleList[]>("GET", "/v1/tenant/messaging/rules");
  },

  toggleRule(eventType: string, channel: string, enabled: boolean) {
    return platformRequest<NotificationRule>(
      "PATCH",
      `/v1/tenant/messaging/rules/${eventType}/${channel}`,
      { body: { enabled } },
    );
  },

  listTemplates() {
    return platformRequest<MessageTemplate[]>(
      "GET",
      "/v1/tenant/messaging/templates",
    );
  },

  getTemplate(uuid: string) {
    return platformRequest<MessageTemplate>(
      "GET",
      `/v1/tenant/messaging/templates/${uuid}`,
    );
  },

  upsertTemplate(body: UpsertTemplateInput) {
    return platformRequest<MessageTemplate>(
      "POST",
      "/v1/tenant/messaging/templates",
      { body },
    );
  },

  patchTemplate(uuid: string, body: PatchTemplateInput) {
    return platformRequest<MessageTemplate>(
      "PATCH",
      `/v1/tenant/messaging/templates/${uuid}`,
      { body },
    );
  },

  deleteTemplate(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/messaging/templates/${uuid}`,
    );
  },

  simulate(body: SimulateInput) {
    return platformRequest<SimulateResult>(
      "POST",
      "/v1/tenant/messaging/simulate",
      { body },
    );
  },
};
