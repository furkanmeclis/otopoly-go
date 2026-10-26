/** Reviews hooks (web `features/reviews/hooks/use-reviews.ts`). Keys live under `qk.reviews`. */
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { qk, useInfiniteList } from '@/features/queries';
import { reviewsService } from '@/features/reviews/services/reviews.service';
import type { ReviewListParams, UpdateReviewSettingsInput } from '@/features/reviews/types';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

type Params = Record<string, string | number | undefined>;

export const reviewKeys = {
  all: qk.reviews,
  summary: (days: number) => [...qk.reviews, 'summary', days] as const,
  detail: (uuid: string) => [...qk.reviews, 'detail', uuid] as const,
  settings: [...qk.reviews, 'settings'] as const,
  customer: (uuid: string) => [...qk.reviews, 'by-customer', uuid] as const,
};

/** Reads: owners and staff (`tenant.reviews.read`); writes: owners (backend requires the owner role). */
export function useReviewsAccess() {
  const { can } = useAuth();
  return { canRead: can(P.reviewsRead), canWrite: can({ perm: P.reviewsWrite, owner: true }) };
}

export const useReviewsInfinite = (params: ReviewListParams, enabled = true) =>
  useInfiniteList([...qk.reviews, 'infinite'], (p: Params) => reviewsService.list(p as ReviewListParams), params as Params, enabled);

export const useReviewSummary = (days = 30, enabled = true) =>
  useQuery({ queryKey: reviewKeys.summary(days), queryFn: () => reviewsService.summary(days), enabled, retry: false, staleTime: 30_000 });

export const useReview = (uuid: string) => useQuery({ queryKey: reviewKeys.detail(uuid), queryFn: () => reviewsService.get(uuid), enabled: Boolean(uuid), retry: false });

export const useReviewSettings = (enabled = true) => useQuery({ queryKey: reviewKeys.settings, queryFn: () => reviewsService.settings(), enabled, retry: false });

export const useCustomerReviews = (customerUuid: string, enabled = true) =>
  useQuery({ queryKey: reviewKeys.customer(customerUuid), queryFn: () => reviewsService.list({ customer_uuid: customerUuid, limit: 20 }), enabled: enabled && Boolean(customerUuid), retry: false });

export function useReviewMutations() {
  const { t } = useLocale();
  const invalidate = [qk.reviews];
  return {
    followUp: useApiMutation({
      key: 'reviews.follow_up',
      fn: ({ uuid, note }: { uuid: string; note: string }) => reviewsService.followUp(uuid, note),
      invalidate,
      success: t('reviews.toast.followed_up'),
      toastValidation: true,
    }),
    saveSettings: useApiMutation({
      key: 'reviews.settings.save',
      fn: (body: UpdateReviewSettingsInput) => reviewsService.saveSettings(body),
      invalidate,
      success: t('reviews.toast.settings_saved'),
    }),
    sendTest: useApiMutation({
      key: 'reviews.settings.test',
      fn: (phone?: string) => reviewsService.sendTest(phone),
      invalidate,
      toastValidation: true,
    }),
  };
}
