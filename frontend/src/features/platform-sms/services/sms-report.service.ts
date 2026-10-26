import type { components } from "@/generated/api";
import { platformRequest } from "@/lib/api/platform-request";

export type SmsReport = components["schemas"]["SmsReport"];
export type SmsReportOrganization =
  components["schemas"]["SmsReportOrganization"];
export type SmsReportMessage = components["schemas"]["SmsReportMessage"];
export type SmsReportMessagesPage =
  components["schemas"]["SmsReportMessagesPage"];

export const smsReportKeys = {
  all: ["platform", "sms-report"] as const,
  report: (from: string, to: string) =>
    [...smsReportKeys.all, "report", from, to] as const,
  messages: (uuid: string, params: { limit: number; offset: number }) =>
    [...smsReportKeys.all, "messages", uuid, params] as const,
};

export const smsReportService = {
  report(from: string, to: string) {
    return platformRequest<SmsReport>(
      "GET",
      "/v1/platform/messaging/sms/report",
      { query: { from, to } },
    );
  },
  messages(uuid: string, params: { limit: number; offset: number }) {
    return platformRequest<SmsReportMessagesPage>(
      "GET",
      `/v1/platform/messaging/sms/organizations/${uuid}/messages`,
      { query: params },
    );
  },
};
