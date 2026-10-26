import { apiClient, unwrap } from "@/lib/api";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarFeed,
  CalendarFeedItem,
  CalendarMeta,
  CalendarMoveInput,
} from "@/features/calendar/types";

export const calendarService = {
  async meta() {
    return unwrap<CalendarMeta>(
      await apiClient.GET("/v1/tenant/calendar/meta"),
    );
  },
  async feed(params: { from: string; to: string; layers?: string }) {
    return unwrap<CalendarFeed>(
      await apiClient.GET("/v1/tenant/calendar/feed", {
        params: { query: params },
      }),
      { silent: true },
    );
  },
  async move(body: CalendarMoveInput) {
    return unwrap<CalendarFeedItem>(
      await apiClient.POST("/v1/tenant/calendar/items/move", { body }),
    );
  },
  async createEvent(body: CalendarEventInput) {
    return unwrap<CalendarEvent>(
      await apiClient.POST("/v1/tenant/calendar/events", { body }),
    );
  },
  async getEvent(uuid: string) {
    return unwrap<CalendarEvent>(
      await apiClient.GET("/v1/tenant/calendar/events/{uuid}", {
        params: { path: { uuid } },
      }),
      { silent: true },
    );
  },
  async updateEvent(uuid: string, body: CalendarEventInput) {
    return unwrap<CalendarEvent>(
      await apiClient.PUT("/v1/tenant/calendar/events/{uuid}", {
        params: { path: { uuid } },
        body,
      }),
    );
  },
  async deleteEvent(uuid: string) {
    return unwrap<{ deleted: boolean }>(
      await apiClient.DELETE("/v1/tenant/calendar/events/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
};
