export type WhatsAppSessionStatus = "disconnected" | "qr_pending" | "connected" | "error";

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

export const AVAILABLE_CHANNELS = ["whatsapp", "sms"] as const;
export type Channel = (typeof AVAILABLE_CHANNELS)[number];

export const EVENT_VARIABLES: Record<string, string[]> = {
  "job.created": ["customer_name", "business_name", "job_id", "plate"],
  "contract.signed": ["customer_name", "business_name", "contract_title", "plate"],
  "job.ready": ["customer_name", "business_name", "job_id", "plate"],
  "job.delivered": ["customer_name", "business_name", "job_id", "plate"],
  "job.completed": ["customer_name", "business_name", "job_id", "plate"],
  "job.paid": ["customer_name", "business_name", "amount", "currency", "plate"],
  "job.cancelled": ["customer_name", "business_name", "job_id", "plate"],
  "sale.created": ["customer_name", "business_name", "amount", "currency"],
};

export const EVENT_LABELS: Record<string, string> = {
  "job.created": "İş Oluşturuldu",
  "contract.signed": "Sözleşme İmzalandı",
  "job.ready": "Araç Teslime Hazır",
  "job.delivered": "Araç Teslim Edildi",
  "job.completed": "İş Tamamlandı",
  "job.paid": "Ödeme Alındı",
  "job.cancelled": "İş İptal Edildi",
  "sale.created": "Satış Oluşturuldu",
};

export const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Ahmet Yılmaz",
  business_name: "Tech Oto",
  job_id: "JOB-DEMO-001",
  plate: "34 ABC 123",
  amount: "1.250,00",
  currency: "TRY",
  contract_title: "Hizmet Sözleşmesi",
};

export function renderTemplatePreview(
  body: string,
  vars: Record<string, string> = SAMPLE_VARS,
): string {
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
    out = out.replaceAll(`{{.${key}}}`, value);
  }
  return out;
}

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  "job.created": {
    subject: "Aracınız Kabul Edildi",
    body: "Sayın {{customer_name}},\n\nAracınız ({{plate}}) servisimize alındı. İş No: {{job_id}}\n\nGelişmeleri size bildireceğiz.\n{{business_name}}",
  },
  "contract.signed": {
    subject: "Sözleşmeniz İmzalandı",
    body: 'Sayın {{customer_name}},\n\n"{{contract_title}}" sözleşmeniz başarıyla imzalandı.\nPlaka: {{plate}}\n\nİyi günler dileriz.\n{{business_name}}',
  },
  "job.ready": {
    subject: "Aracınız Hazır",
    body: "Sayın {{customer_name}},\n\nAracınızın işlemi tamamlandı, teslime hazır.\nİş No: {{job_id}} | Plaka: {{plate}}\n\nİyi günler dileriz.\n{{business_name}}",
  },
  "job.delivered": {
    subject: "Aracınız Teslim Edildi",
    body: "Sayın {{customer_name}},\n\nAracınız ({{plate}}) teslim edildi. İş No: {{job_id}}\n\nBizi tercih ettiğiniz için teşekkürler.\n{{business_name}}",
  },
  "job.completed": {
    subject: "Aracınız Hazır",
    body: "Sayın {{customer_name}},\n\nAracınızın yıkama işlemi tamamlandı, teslime hazır. İş No: {{job_id}} | Plaka: {{plate}}\n\nİyi günler dileriz.\n{{business_name}}",
  },
  "job.paid": {
    subject: "Ödemeniz Alındı",
    body: "Sayın {{customer_name}},\n\nÖdemeniz başarıyla alındı. Tutar: {{amount}} {{currency}}\nPlaka: {{plate}}\n\nTeşekkür ederiz.\n{{business_name}}",
  },
  "job.cancelled": {
    subject: "İşlem İptal Edildi",
    body: "Sayın {{customer_name}},\n\n{{plate}} plakalı aracınız için işlem iptal edildi. İş No: {{job_id}}\n\nSorularınız için bize ulaşabilirsiniz.\n{{business_name}}",
  },
  "sale.created": {
    subject: "Satışınız Oluşturuldu",
    body: "Sayın {{customer_name}},\n\nSatışınız oluşturuldu. Tutar: {{amount}} {{currency}}\n\nTeşekkür ederiz.\n{{business_name}}",
  },
};
