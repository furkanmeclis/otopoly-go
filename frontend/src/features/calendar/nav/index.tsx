"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import { useCalendarFeed } from "@/features/calendar/hooks/use-calendar";
import { LAYER_DEFS } from "@/features/calendar/lib/layers";
import { CALENDAR_LAYERS, type CalendarLayer } from "@/features/calendar/types";
import { permissions } from "@/config/permissions";
import { usePermission } from "@/providers/permission-provider";
import { useLocale } from "@/providers/locale-provider";
import { businessToday, shiftDay } from "@/lib/utils/business-date";

/** Layers counted as "today" in the sidebar (finance day totals are not). */
const COUNTED: CalendarLayer[] = CALENDAR_LAYERS.filter((l) => l !== "finance");

function useCalendarNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { hasPermission } = usePermission();
  const canRead = hasPermission(permissions.calendar.read);
  const today = businessToday();
  const { data } = useCalendarFeed(today, shiftDay(today, 1), COUNTED, canRead);
  if (!data) return {};
  const total = data.items.length;
  const rows = COUNTED.filter((l) => (data.counts[l] ?? 0) > 0)
    .slice(0, 5)
    .map((l) => ({ label: t(LAYER_DEFS[l].labelKey), value: data.counts[l] }));
  return {
    badges:
      total > 0 ? [{ kind: "count", value: total, variant: "secondary" }] : [],
    info: {
      title: t("calendar.nav.today"),
      rows:
        rows.length > 0
          ? rows
          : [{ label: t("calendar.nav.nothing_today"), value: 0 }],
    },
  };
}

export const CalendarNavAdornment = createNavAdornment(useCalendarNavAdornment);
