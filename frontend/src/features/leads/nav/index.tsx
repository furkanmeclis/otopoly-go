"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import {
  useLeadsAccess,
  useLeadSummary,
} from "@/features/leads/hooks/use-leads";
import { useLocale } from "@/providers/locale-provider";

function useLeadsNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { canRead } = useLeadsAccess();
  const { data } = useLeadSummary(canRead);
  const due = (data?.overdue ?? 0) + (data?.due_today ?? 0);
  return {
    badges: [
      {
        kind: "count",
        value: due,
        variant: (data?.overdue ?? 0) > 0 ? "danger" : "secondary",
      },
    ],
    info: data
      ? {
          title: t("leads.title"),
          rows: [
            {
              label: t("leads.summary.overdue"),
              value: data.overdue,
              tone: "danger",
            },
            {
              label: t("leads.summary.today"),
              value: data.due_today,
              tone: "warning",
            },
            { label: t("leads.summary.hot"), value: data.hot },
            { label: t("leads.summary.open"), value: data.open },
          ],
        }
      : undefined,
  };
}

export const LeadsNavAdornment = createNavAdornment(useLeadsNavAdornment);
