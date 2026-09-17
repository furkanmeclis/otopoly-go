export type WhatsAppSessionStatus = "disconnected" | "qr_pending" | "connected" | "error";

export interface WhatsAppSession {
  uuid: string;
  status: WhatsAppSessionStatus;
  jid?: string;
  phone_number?: string;
  display_name?: string;
  last_seen_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface QRCodeResponse {
  code: string;
  expires_at: string;
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

export const AVAILABLE_CHANNELS = ["whatsapp", "sms"] as const;
export type Channel = (typeof AVAILABLE_CHANNELS)[number];

export const EVENT_VARIABLES: Record<string, string[]> = {
  "contract.signed": ["customer_name", "business_name", "contract_title"],
  "job.completed": ["customer_name", "business_name", "job_id", "plate"],
  "job.paid": ["customer_name", "business_name", "amount", "currency"],
  "sale.created": ["customer_name", "business_name", "amount", "currency"],
};

export const EVENT_LABELS: Record<string, string> = {
  "contract.signed": "Sözleşme İmzalandı",
  "job.completed": "İş Tamamlandı",
  "job.paid": "İş Ödendi",
  "sale.created": "Satış Oluşturuldu",
};
