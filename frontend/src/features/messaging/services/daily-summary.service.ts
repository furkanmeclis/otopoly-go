import { platformRequest } from "@/lib/api/platform-request";

export type DailySummaryMember = {
  uuid: string;
  name: string;
  email: string;
  role: "owner" | "staff" | string;
  has_phone: boolean;
};

export type DailySummarySettings = {
  enabled: boolean;
  /** Local (Europe/Istanbul) time, HH:MM. */
  send_time: string;
  recipient_user_uuids: string[];
  last_sent_on?: string | null;
  whatsapp_connected: boolean;
  members: DailySummaryMember[];
};

export type DailySummaryInput = {
  enabled: boolean;
  send_time: string;
  recipient_user_uuids: string[];
};

export const dailySummaryService = {
  get() {
    return platformRequest<DailySummarySettings>(
      "GET",
      "/v1/tenant/daily-summary",
    );
  },
  update(body: DailySummaryInput) {
    return platformRequest<DailySummarySettings>(
      "PUT",
      "/v1/tenant/daily-summary",
      { body },
    );
  },
  preview() {
    return platformRequest<{ message: string; date: string }>(
      "GET",
      "/v1/tenant/daily-summary/preview",
    );
  },
  sendTest() {
    return platformRequest<{ sent: number; skipped: string[] }>(
      "POST",
      "/v1/tenant/daily-summary/test",
    );
  },
};
