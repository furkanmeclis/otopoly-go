import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type Review = Schemas['Review'];
export type ReviewDetail = Schemas['ReviewDetail'];
export type ReviewStatus = Schemas['ReviewStatus'];
export type ReviewFollowUpStatus = Schemas['ReviewFollowUpStatus'];
export type ReviewChannelPreference = Schemas['ReviewChannelPreference'];
export type ReviewSummary = Schemas['ReviewSummary'];
export type ReviewSettings = Schemas['ReviewSettings'];
export type UpdateReviewSettingsInput = Schemas['UpdateReviewSettingsRequest'];
export type ReviewTestResult = Schemas['ReviewTestResult'];
export type PublicReview = Schemas['PublicReview'];

/** Query of `GET /v1/tenant/reviews` (web `features/reviews/types.ts`). */
export type ReviewListParams = {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
  status?: ReviewStatus;
  follow_up?: ReviewFollowUpStatus;
  rating?: 'high' | 'low';
  score?: number;
  channel?: 'sms' | 'whatsapp';
  customer_uuid?: string;
  days?: number;
  include_tests?: boolean;
};

export type ReviewPage = { items: Review[]; total: number; limit: number; offset: number };

export const REVIEW_STATUSES: ReviewStatus[] = ['scheduled', 'sent', 'opened', 'answered', 'expired', 'cancelled', 'skipped', 'failed'];
export const REVIEW_FOLLOW_UPS: ReviewFollowUpStatus[] = ['none', 'required', 'done'];
