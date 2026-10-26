/** Labels of classified SMS send / check error codes (web `features/messaging/lib/send-errors.ts`, SMS part). */
const SMS_ERROR_KEYS: Record<string, string> = {
  sms_not_configured: 'mobile.messaging.errors.sms_not_configured',
  sms_auth_failed: 'mobile.messaging.errors.sms_auth_failed',
  sms_rejected: 'mobile.messaging.errors.sms_rejected',
  sms_unavailable: 'mobile.messaging.errors.sms_unavailable',
  sms_outcome_unknown: 'mobile.messaging.errors.sms_outcome_unknown',
  feature_not_entitled: 'mobile.messaging.errors.sms_feature_not_entitled',
  quota_exceeded: 'mobile.messaging.errors.sms_quota_exceeded',
};

export function smsErrorLabel(t: (key: string) => string, code?: string | null): string {
  const key = SMS_ERROR_KEYS[(code ?? '').trim().toLowerCase()];
  return key ? t(key) : '';
}
