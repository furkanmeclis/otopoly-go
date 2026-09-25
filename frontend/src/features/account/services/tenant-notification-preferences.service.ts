import { apiClient, unwrap } from "@/lib/api";
import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type NotificationTypePreferences =
  Schemas["NotificationTypePreferences"];
export type NotificationChannelPrefs = Schemas["NotificationChannelPrefs"];
export type UpdateNotificationTypePreferencesInput =
  Schemas["UpdateNotificationTypePreferencesRequest"];

export const tenantNotificationPreferencesService = {
  async get() {
    return unwrap<NotificationTypePreferences>(
      await apiClient.GET("/v1/tenant/notification-preferences"),
    );
  },
  async update(body: UpdateNotificationTypePreferencesInput) {
    return unwrap<NotificationTypePreferences>(
      await apiClient.PUT("/v1/tenant/notification-preferences", { body }),
    );
  },
};
