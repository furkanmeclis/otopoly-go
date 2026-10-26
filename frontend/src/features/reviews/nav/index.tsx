"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import {
  useReviewsAccess,
  useReviewSummary,
} from "@/features/reviews/hooks/use-reviews";
import { useLocale } from "@/providers/locale-provider";

function useReviewsNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { canRead } = useReviewsAccess();
  const { data } = useReviewSummary(30, canRead);
  return {
    badges: [
      {
        kind: "count",
        value: data?.follow_up_required ?? 0,
        variant: "warning",
      },
    ],
    info: data
      ? {
          title: t("reviews.title"),
          rows: [
            {
              label: t("reviews.summary.average"),
              value: data.answered_count ? data.average_score.toFixed(1) : "—",
            },
            {
              label: t("reviews.summary.follow_up"),
              value: data.follow_up_required,
              tone: "warning",
            },
          ],
        }
      : undefined,
  };
}

export const ReviewsNavAdornment = createNavAdornment(useReviewsNavAdornment);
