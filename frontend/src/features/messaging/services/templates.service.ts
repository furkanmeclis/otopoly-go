import { apiClient, unwrap } from "@/lib/api";
import type { components } from "@/generated/api";

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

export const templatesService = {
  async catalog() {
    return unwrap<MessageTemplateType[]>(
      await apiClient.GET("/v1/tenant/messaging/template-types"),
    );
  },
  async save(key: TemplateKey, body: SaveMessageTemplateInput) {
    return unwrap<MessageTemplateEntry>(
      await apiClient.PUT(
        "/v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}",
        {
          params: {
            path: {
              event_type: key.eventType,
              channel: key.channel,
              locale: key.locale,
            },
          },
          body,
        },
      ),
    );
  },
  async reset(key: TemplateKey) {
    return unwrap<MessageTemplateEntry>(
      await apiClient.DELETE(
        "/v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}",
        {
          params: {
            path: {
              event_type: key.eventType,
              channel: key.channel,
              locale: key.locale,
            },
          },
        },
      ),
    );
  },
};
