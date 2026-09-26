import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type Quote = Schemas["Quote"];
export type QuoteDetail = Schemas["QuoteDetail"];
export type QuoteLine = Schemas["QuoteLine"];
export type QuoteEvent = Schemas["QuoteEvent"];
export type QuoteDelivery = Schemas["QuoteDelivery"];
export type QuoteReminder = Schemas["QuoteReminder"];
export type QuoteSummary = Schemas["QuoteSummary"];
export type QuoteStatus = Schemas["QuoteStatus"];
export type SaveQuoteInput = Schemas["SaveQuoteRequest"];
export type QuoteLineInput = Schemas["QuoteLineInput"];
export type QuoteReminderInput = Schemas["QuoteReminderInput"];
export type SendQuoteInput = Schemas["SendQuoteRequest"];
export type QuoteSendResult = Schemas["QuoteSendResult"];
export type QuoteSendPreview = Schemas["QuoteSendPreview"];
export type ConvertQuoteInput = Schemas["ConvertQuoteRequest"];
export type QuoteConvertPreview = Schemas["QuoteConvertPreview"];
export type QuoteConvertResult = Schemas["QuoteConvertResult"];
export type PublicQuote = Schemas["PublicQuote"];

export type DiscountType = "none" | "percent" | "amount";
export type ReminderKind = QuoteReminderInput["kind"];

export const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
];

export type QuoteListParams = {
  status?: string;
  customer_uuid?: string;
  lead_uuid?: string;
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};

export type QuotePage = {
  items: Quote[];
  total: number;
  limit: number;
  offset: number;
};
