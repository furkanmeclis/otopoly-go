"use client";

import { ListTodo, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { TodoDialog } from "@/features/todos/components/todo-dialog";
import { TodoItem } from "@/features/todos/components/todo-item";
import {
  useTodoMutations,
  useTodos,
  useTodosAccess,
  useTodoSummary,
} from "@/features/todos/hooks/use-todos";
import { localToday } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

const WIDGET_PARAMS = { status: "open", scope: "open_due", limit: 8 } as const;

/** Dashboard card: overdue + today's open todos with quick complete. */
export function TodosWidget({ slug }: { slug: string }) {
  const { t } = useLocale();
  const access = useTodosAccess();
  const list = useTodos(WIDGET_PARAMS, access.canRead);
  const summary = useTodoSummary(access.canRead);
  const { toggle } = useTodoMutations();
  const [open, setOpen] = useState(false);
  if (!access.canRead) return null;
  const items = list.data?.items ?? [];
  const overdue = summary.data?.overdue ?? 0;

  return (
    <section
      className="bg-card flex flex-col rounded-2xl border"
      data-widget="todos"
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="text-primary size-4" />
          {t("todos.widget.title")}
          {overdue > 0 ? (
            <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-[11px] font-medium">
              {t("todos.widget.overdue", { count: overdue })}
            </span>
          ) : null}
        </h2>
        <div className="flex items-center gap-1">
          {access.canWrite ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setOpen(true)}
              aria-label={t("todos.actions.create")}
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
          <Link
            href={routes.tenant.todos.root(slug)}
            className="text-primary text-xs font-medium hover:underline"
          >
            {t("todos.widget.all")}
          </Link>
        </div>
      </div>
      {list.isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground px-6 py-6 text-center text-sm">
          {t("todos.widget.empty")}
        </p>
      ) : (
        <div className="divide-y">
          {items.map((todo) => (
            <TodoItem
              key={todo.uuid}
              todo={todo}
              slug={slug}
              compact
              canWrite={access.canWrite}
              onToggle={(item, done) =>
                toggle.mutate({ uuid: item.uuid, done })
              }
            />
          ))}
        </div>
      )}
      <TodoDialog
        open={open}
        onOpenChange={setOpen}
        defaultDueDate={localToday()}
      />
    </section>
  );
}
