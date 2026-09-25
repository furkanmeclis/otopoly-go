import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type Lead = Schemas["Lead"];
export type LeadDetail = Schemas["LeadDetail"];
export type LeadEvent = Schemas["LeadEvent"];
export type LeadSummary = Schemas["LeadSummary"];
export type LeadAssignee = Schemas["LeadAssignee"];
export type LeadSource = Schemas["LeadSource"];
export type CreateLeadInput = Schemas["CreateLeadRequest"];
export type PatchLeadInput = Schemas["PatchLeadRequest"];
export type LeadTodoInput = Schemas["LeadTodoRequest"];
export type LeadTodoResult = Schemas["LeadTodoResult"];

export type LeadStatus = Lead["status"];
export type LeadTemperature = Lead["temperature"];

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
];
export const LEAD_TEMPERATURES: LeadTemperature[] = ["cold", "warm", "hot"];
export const LEAD_SOURCES: LeadSource[] = [
  "incoming_call",
  "outgoing_call",
  "walk_in",
  "whatsapp",
  "social",
  "referral",
  "website",
  "other",
];

export type LeadListParams = {
  status?: string;
  temperature?: string;
  source?: string;
  assignee?: string;
  follow_up?: "overdue" | "today";
  customer_uuid?: string;
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};

export type LeadPage = {
  items: Lead[];
  total: number;
  limit: number;
  offset: number;
};
