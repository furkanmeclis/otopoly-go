import { request } from "@/api/client";
import type { components } from "@/api/generated/api";

type Schemas = components["schemas"];

export type NotificationTypePreferences =
  Schemas["NotificationTypePreferences"];
export type NotificationChannelPrefs = Schemas["NotificationChannelPrefs"];
export type UpdateNotificationTypePreferencesInput =
  Schemas["UpdateNotificationTypePreferencesRequest"];

export const tenantNotificationPreferencesService = {
  get() {
    return request<NotificationTypePreferences>("GET", "/v1/tenant/notification-preferences");
  },
  update(body: UpdateNotificationTypePreferencesInput) {
    return request<NotificationTypePreferences>("PUT", "/v1/tenant/notification-preferences", { body });
  },
};
