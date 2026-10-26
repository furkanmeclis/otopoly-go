import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type CalendarLayer = Schemas["CalendarLayer"];
export type CalendarLayerInfo = Schemas["CalendarLayerInfo"];
export type CalendarMeta = Schemas["CalendarMeta"];
export type CalendarEvent = Schemas["CalendarEvent"];
export type CalendarEventInput = Schemas["CalendarEventInput"];
export type CalendarMoveInput = Schemas["CalendarMoveInput"];
export type CalendarFeedItem = Schemas["CalendarFeedItem"];
export type CalendarFeed = Schemas["CalendarFeed"];
export type CalendarEventColor = Schemas["CalendarColor"];

/** Every layer in display order (mirrors the API enum). */
export const CALENDAR_LAYERS: readonly CalendarLayer[] = [
  "events",
  "jobs",
  "deliveries",
  "todos",
  "quotes",
  "leads",
  "finance",
  "sales",
  "purchases",
  "contracts",
];
