export type WhatsAppSessionStatus =
  "disconnected" | "qr_pending" | "connected" | "error";

export interface WhatsAppSession {
  uuid: string;
  status: WhatsAppSessionStatus;
  jid?: string;
  phone_number?: string;
  display_name?: string;
  qr_code?: string;
  qr_expires_at?: string;
  last_seen_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRule {
  uuid: string;
  event_type: string;
  channel: string;
  enabled: boolean;
}

export interface RuleList {
  event_type: string;
  event_label: string;
  rules: NotificationRule[];
}

export interface MessageTemplate {
  uuid: string;
  event_type: string;
  channel: string;
  locale: string;
  subject: string;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertTemplateInput {
  event_type: string;
  channel: string;
  locale: string;
  subject: string;
  body: string;
  variables?: string[];
}

export interface PatchTemplateInput {
  subject?: string;
  body?: string;
  variables?: string[];
  is_active?: boolean;
}

export interface SimulateInput {
  mode?: "event" | "job_lifecycle";
  event_type?: string;
  channel?: "whatsapp";
  phone: string;
  vars?: Record<string, string>;
}

export interface SimulateResultItem {
  event_type: string;
  channel: string;
  status: string;
  body?: string;
  provider_reference?: string;
  error_message?: string;
}

export interface SimulateResult {
  items: SimulateResultItem[];
}

/** Demo values for the job lifecycle simulation. */
export const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Ahmet Yılmaz",
  business_name: "Tech Oto",
  company_name: "Tech Oto",
  job_id: "JOB-DEMO-001",
  plate: "34 ABC 123",
  amount: "1.250,00",
  currency: "TRY",
  contract_title: "Hizmet Sözleşmesi",
};
