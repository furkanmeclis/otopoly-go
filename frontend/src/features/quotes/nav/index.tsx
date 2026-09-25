"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import {
  useQuotesAccess,
  useQuoteSummary,
} from "@/features/quotes/hooks/use-quotes";
import { useLocale } from "@/providers/locale-provider";

function useQuotesNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { canRead } = useQuotesAccess();
  const { data } = useQuoteSummary(canRead);
  return {
    badges: [
      {
        kind: "count",
        value: data?.expiring_soon ?? 0,
        variant: "warning",
      },
    ],
    info: data
      ? {
          title: t("quotes.title"),
          rows: [
            { label: t("quotes.summary.awaiting"), value: data.awaiting_count },
            {
              label: t("quotes.summary.expiring"),
              value: data.expiring_soon,
              tone: "warning",
            },
            { label: t("quotes.summary.drafts"), value: data.draft_count },
          ],
        }
      : undefined,
  };
}

export const QuotesNavAdornment = createNavAdornment(useQuotesNavAdornment);
