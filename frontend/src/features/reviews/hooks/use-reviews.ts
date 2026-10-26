"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { reviewsService } from "@/features/reviews/services/reviews.service";
import type {
  ReviewDetail,
  ReviewListParams,
  UpdateReviewSettingsInput,
} from "@/features/reviews/types";
import { isApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const reviewsKeys = {
  all: ["tenant", "reviews"] as const,
  meta: () => [...reviewsKeys.all, "meta"] as const,
  list: (params?: ReviewListParams) =>
    [...reviewsKeys.all, "list", params] as const,
  summary: (days: number) => [...reviewsKeys.all, "summary", days] as const,
  detail: (uuid: string) => [...reviewsKeys.all, "detail", uuid] as const,
  settings: () => [...reviewsKeys.all, "settings"] as const,
};

/** Reads: owners and staff; writes (settings, test send, "ele alındı"): owners. */
export function useReviewsAccess(slug?: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = slug
    ? user?.organizations.find((org) => org.slug === slug)
    : undefined;
  const isOwner = slug ? membership?.role === "owner" : true;
  return {
    canRead: hasPermission(permissions.reviews.read),
    canWrite: Boolean(isOwner) && hasPermission(permissions.reviews.write),
  };
}

export function useReviewsMeta(enabled = true) {
  return useQuery({
    queryKey: reviewsKeys.meta(),
    queryFn: () => reviewsService.meta(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useReviews(params: ReviewListParams, enabled = true) {
  return useQuery({
    queryKey: reviewsKeys.list(params),
    queryFn: () => reviewsService.list(params),
    enabled,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

export function useReviewSummary(days = 30, enabled = true) {
  return useQuery({
    queryKey: reviewsKeys.summary(days),
    queryFn: () => reviewsService.summary(days),
    enabled,
    retry: false,
    refetchInterval: 120_000,
  });
}

export function useReview(uuid: string) {
  return useQuery({
    queryKey: reviewsKeys.detail(uuid),
    queryFn: () => reviewsService.get(uuid),
    enabled: Boolean(uuid),
    retry: false,
  });
}

export function useReviewSettings(enabled = true) {
  return useQuery({
    queryKey: reviewsKeys.settings(),
    queryFn: () => reviewsService.settings(),
    enabled,
    retry: false,
  });
}

/** Translated API error (reviews.errors.<CODE>) or the server message. */
export function useReviewErrorText() {
  const { t } = useLocale();
  return (err: unknown) => {
    if (isApiError(err)) {
      const key = `reviews.errors.${err.code}`;
      const translated = t(key);
      return translated !== key ? translated : err.message;
    }
    return t("reviews.errors.generic");
  };
}

export function useReviewMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const errorText = useReviewErrorText();
  const store = (review: ReviewDetail) => {
    qc.setQueryData(reviewsKeys.detail(review.uuid), review);
    void qc.invalidateQueries({ queryKey: reviewsKeys.all });
  };
  return {
    followUp: useMutation({
      mutationFn: ({ uuid, note }: { uuid: string; note: string }) =>
        reviewsService.followUp(uuid, note),
      onSuccess: (data) => {
        store(data);
        toast.success(t("reviews.toast.followed_up"));
      },
      onError: (err) => toast.error(errorText(err)),
    }),
    saveSettings: useMutation({
      mutationFn: (body: UpdateReviewSettingsInput) =>
        reviewsService.saveSettings(body),
      onSuccess: (data) => {
        qc.setQueryData(reviewsKeys.settings(), data);
        toast.success(t("reviews.toast.settings_saved"));
      },
      onError: (err) => toast.error(errorText(err)),
    }),
    sendTest: useMutation({
      mutationFn: (phone?: string) => reviewsService.sendTest(phone),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: reviewsKeys.all });
      },
      onError: (err) => toast.error(errorText(err)),
    }),
  };
}
