/** Per-organization SMS channels (web `features/messaging/services/sms.service.ts`). */
import type { components } from '@/api/generated/api';
import { platformRequest } from '@/api/client';

type Schemas = components['schemas'];

export type SmsProviderCode = 'netgsm' | 'twilio';
export type SmsChannelOverview = Schemas['SmsChannelOverview'];
export type SmsProviderEntry = Schemas['SmsProviderEntry'];
export type SmsProviderAccount = Schemas['SmsProviderAccount'];
export type SmsTestResult = Schemas['SmsTestResult'];
export type SmsTestSmsResult = Schemas['SmsTestSmsResult'];
export type SmsEstimate = Schemas['SmsEstimate'];
export type SmsSegments = Schemas['SmsSegments'];
/** Empty credential values keep the stored ones. */
export type SaveSmsProviderInput = Schemas['SaveSmsProviderRequest'];

const base = '/v1/tenant/messaging/sms';

export const smsService = {
  overview: () => platformRequest<SmsChannelOverview>('GET', base),
  save: (provider: SmsProviderCode, body: SaveSmsProviderInput) => platformRequest<SmsProviderAccount>('PUT', `${base}/${provider}`, { body }),
  setActive: (provider: SmsProviderCode, isActive: boolean) => platformRequest<SmsProviderAccount>('PATCH', `${base}/${provider}`, { body: { is_active: isActive } }),
  disconnect: (provider: SmsProviderCode) => platformRequest<{ success: boolean }>('DELETE', `${base}/${provider}`),
  test: (provider: SmsProviderCode) => platformRequest<SmsTestResult>('POST', `${base}/${provider}/test`),
  sendTest: (provider: SmsProviderCode, body: { phone: string; body?: string }) => platformRequest<SmsTestSmsResult>('POST', `${base}/${provider}/test-sms`, { body }),
  /** Silent: the live counter must never toast while typing. */
  estimate: (body: string, provider?: SmsProviderCode) => platformRequest<SmsEstimate>('POST', `${base}/estimate`, { body: { body, provider }, silent: true }),
};
