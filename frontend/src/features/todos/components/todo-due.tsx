"use client";

import { CalendarClock } from "lucide-react";

import type { Todo } from "@/features/todos/types";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { localToday, shiftDate } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

/** Due date chip: "Bugün 14:00", "Yarın", "3 Eki" (red when overdue). */
export function TodoDue({ todo }: { todo: Todo }) {
  const { t, locale } = useLocale();
  if (!todo.due_date) return null;
  const today = localToday();
  const label =
    todo.due_date === today
      ? t("todos.due.today")
      : todo.due_date === shiftDate(today, 1)
        ? t("todos.due.tomorrow")
        : todo.due_date === shiftDate(today, -1)
          ? t("todos.due.yesterday")
          : datetime(`${todo.due_date}T00:00:00`, "d MMM", locale);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        todo.overdue
          ? "text-destructive font-medium"
          : todo.due_date === today && todo.status === "open"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
      )}
    >
      <CalendarClock className="size-3" />
      {label}
      {todo.due_time ? ` ${todo.due_time}` : ""}
    </span>
  );
}
