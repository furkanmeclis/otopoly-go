"use client";

import {
  BellRing,
  FileText,
  Pencil,
  Sparkles,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { routes } from "@/config/routes";
import { TodoDue } from "@/features/todos/components/todo-due";
import type { Todo } from "@/features/todos/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type TodoItemProps = {
  todo: Todo;
  slug: string;
  canWrite: boolean;
  compact?: boolean;
  onToggle: (todo: Todo, done: boolean) => void;
  onEdit?: (todo: Todo) => void;
  onDelete?: (todo: Todo) => void;
};

export function TodoItem({
  todo,
  slug,
  canWrite,
  compact,
  onToggle,
  onEdit,
  onDelete,
}: TodoItemProps) {
  const { t, locale } = useLocale();
  const done = todo.status === "done";
  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4",
        compact ? "py-2" : "py-3",
      )}
      data-todo={todo.uuid}
    >
      <Checkbox
        checked={done}
        disabled={!canWrite}
        onCheckedChange={(v) => onToggle(todo, v === true)}
        aria-label={
          done ? t("todos.actions.reopen") : t("todos.actions.complete")
        }
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-5 break-words",
            done && "text-muted-foreground line-through",
          )}
        >
          {todo.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <TodoDue todo={todo} />
          {todo.assignee ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <UserRound className="size-3" />
              {todo.assignee.label}
            </span>
          ) : null}
          {todo.customer ? (
            <Link
              href={routes.tenant.customers.detail(slug, todo.customer.uuid)}
              className="text-muted-foreground text-xs hover:underline"
            >
              {todo.customer.label}
            </Link>
          ) : null}
          {todo.job ? (
            <Link
              href={routes.tenant.operations.detail(slug, todo.job.uuid)}
              className="text-muted-foreground font-mono text-xs hover:underline"
            >
              {todo.job.label}
            </Link>
          ) : null}
          {todo.lead ? (
            <Link
              href={routes.tenant.leads.detail(slug, todo.lead.uuid)}
              className="bg-muted text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            >
              <Target className="size-3 shrink-0" />
              <span className="truncate">{todo.lead.label}</span>
            </Link>
          ) : null}
          {todo.quote ? (
            <Link
              href={routes.tenant.quotes.detail(slug, todo.quote.uuid)}
              className="bg-muted text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{todo.quote.label}</span>
            </Link>
          ) : null}
          {todo.next_reminder_at && !done ? (
            <span
              className="text-muted-foreground inline-flex items-center gap-1 text-xs"
              title={t("todos.reminders.next", {
                time: new Date(todo.next_reminder_at).toLocaleString(locale),
              })}
            >
              <BellRing className="size-3" />
              {new Date(todo.next_reminder_at).toLocaleString(locale, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          {todo.via_ai ? (
            <span
              className="text-primary inline-flex items-center gap-1 text-[11px]"
              title={t("todos.via_ai")}
            >
              <Sparkles className="size-3" />
              {t("todos.via_ai_short")}
            </span>
          ) : null}
        </div>
        {!compact && todo.notes ? (
          <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
            {todo.notes}
          </p>
        ) : null}
      </div>
      {canWrite && (onEdit || onDelete) ? (
        <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          {onEdit ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => onEdit(todo)}
              aria-label={t("todos.actions.edit")}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => onDelete(todo)}
              aria-label={t("todos.actions.delete")}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
