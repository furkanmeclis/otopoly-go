import { request } from "@/api/client";
import type { components } from "@/api/generated/api";

/** User-level channel switches (web `services/notification-preferences.service.ts`). */
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];

export const notificationPreferencesService = {
  get() {
    return request<NotificationPreferences>("GET", "/v1/notification-preferences");
  },
  update(body: NotificationPreferences) {
    return request<NotificationPreferences>("PUT", "/v1/notification-preferences", { body });
  },
};
