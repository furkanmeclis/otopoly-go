import { platformRequest } from "@/lib/api/platform-request";
import type {
  SaveSmsProviderInput,
  SmsChannelOverview,
  SmsEstimate,
  SmsProviderAccount,
  SmsProviderCode,
  SmsTestResult,
  SmsTestSmsInput,
  SmsTestSmsResult,
} from "@/features/messaging/types";

const base = "/v1/tenant/messaging/sms";

export const smsService = {
  overview() {
    return platformRequest<SmsChannelOverview>("GET", base);
  },

  save(provider: SmsProviderCode, body: SaveSmsProviderInput) {
    return platformRequest<SmsProviderAccount>("PUT", `${base}/${provider}`, {
      body,
    });
  },

  setActive(provider: SmsProviderCode, isActive: boolean) {
    return platformRequest<SmsProviderAccount>("PATCH", `${base}/${provider}`, {
      body: { is_active: isActive },
    });
  },

  disconnect(provider: SmsProviderCode) {
    return platformRequest<{ success: boolean }>(
      "DELETE",
      `${base}/${provider}`,
    );
  },

  test(provider: SmsProviderCode) {
    return platformRequest<SmsTestResult>("POST", `${base}/${provider}/test`);
  },

  sendTest(provider: SmsProviderCode, body: SmsTestSmsInput) {
    return platformRequest<SmsTestSmsResult>(
      "POST",
      `${base}/${provider}/test-sms`,
      { body },
    );
  },

  estimate(body: string, provider?: SmsProviderCode) {
    return platformRequest<SmsEstimate>("POST", `${base}/estimate`, {
      body: { body, provider },
    });
  },
};
