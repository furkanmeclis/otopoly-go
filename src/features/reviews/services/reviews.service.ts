import { platformRequest } from '@/api/client';
import type { ReviewDetail, ReviewListParams, ReviewPage, ReviewSettings, ReviewSummary, ReviewTestResult, UpdateReviewSettingsInput } from '@/features/reviews/types';

const base = '/v1/tenant/reviews';

/** Same calls as web `features/reviews/services/reviews.service.ts` (tenant part; the public page is web only). */
export const reviewsService = {
  list(params: ReviewListParams = {}) {
    const { include_tests, ...rest } = params;
    return platformRequest<ReviewPage>('GET', base, { query: { limit: 20, offset: 0, ...rest, include_tests: include_tests ? 'true' : undefined } });
  },
  summary(days = 30) {
    return platformRequest<ReviewSummary>('GET', `${base}/summary`, { query: { days } });
  },
  get(uuid: string) {
    return platformRequest<ReviewDetail>('GET', `${base}/${uuid}`);
  },
  followUp(uuid: string, note: string) {
    return platformRequest<ReviewDetail>('POST', `${base}/${uuid}/follow-up`, { body: { note } });
  },
  settings() {
    return platformRequest<ReviewSettings>('GET', `${base}/settings`);
  },
  saveSettings(body: UpdateReviewSettingsInput) {
    return platformRequest<ReviewSettings>('PUT', `${base}/settings`, { body });
  },
  sendTest(phone?: string) {
    return platformRequest<ReviewTestResult>('POST', `${base}/settings/test`, { body: phone ? { phone } : {} });
  },
};
