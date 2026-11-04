import { request } from "@/api/client";
import type { components } from "@/api/generated/api";

type Schemas = components["schemas"];

export type MessageTemplateType = Schemas["MessageTemplateType"];
export type MessageTemplateEntry = Schemas["MessageTemplateEntry"];
export type MessageTemplatePlaceholder = Schemas["MessageTemplatePlaceholder"];
export type SaveMessageTemplateInput = Schemas["SaveMessageTemplateRequest"];
export type TemplateChannel = MessageTemplateEntry["channel"];
export type TemplateLocale = MessageTemplateEntry["locale"];

export type TemplateKey = {
  eventType: string;
  channel: TemplateChannel;
  locale: TemplateLocale;
};

const templatePath = (key: TemplateKey) =>
  `/v1/tenant/messaging/template-types/${encodeURIComponent(key.eventType)}/${key.channel}/${key.locale}`;

export const templatesService = {
  catalog() {
    return request<MessageTemplateType[]>("GET", "/v1/tenant/messaging/template-types");
  },
  save(key: TemplateKey, body: SaveMessageTemplateInput) {
    return request<MessageTemplateEntry>("PUT", templatePath(key), { body });
  },
  reset(key: TemplateKey) {
    return request<MessageTemplateEntry>("DELETE", templatePath(key));
  },
};
