"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import {
  useTodosAccess,
  useTodoSummary,
} from "@/features/todos/hooks/use-todos";
import { useLocale } from "@/providers/locale-provider";

function useTodosNavAdornment(): NavAdornment {
  const { t } = useLocale();
  const { canRead } = useTodosAccess();
  const { data } = useTodoSummary(canRead);
  const due = (data?.overdue ?? 0) + (data?.today ?? 0);
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
          title: t("todos.title"),
          rows: [
            {
              label: t("todos.nav.overdue"),
              value: data.overdue,
              tone: "danger",
            },
            { label: t("todos.nav.today"), value: data.today, tone: "warning" },
            { label: t("todos.nav.open"), value: data.open },
          ],
        }
      : undefined,
  };
}

export const TodosNavAdornment = createNavAdornment(useTodosNavAdornment);
