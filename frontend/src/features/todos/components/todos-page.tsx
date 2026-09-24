"use client";

import { ListTodo, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TodoDialog } from "@/features/todos/components/todo-dialog";
import { TodoItem } from "@/features/todos/components/todo-item";
import {
  useTodoMutations,
  useTodos,
  useTodosAccess,
  useTodoSummary,
} from "@/features/todos/hooks/use-todos";
import type { Todo, TodoListParams } from "@/features/todos/types";
import { useLocale } from "@/providers/locale-provider";

type Tab = "due" | "upcoming" | "no_date" | "mine" | "done";

const TAB_PARAMS: Record<Tab, TodoListParams> = {
  due: { status: "open", scope: "open_due" },
  upcoming: { status: "open", scope: "upcoming" },
  no_date: { status: "open", scope: "no_date" },
  mine: { status: "open", assignee: "me" },
  done: { status: "done", limit: 30 },
};

export function TodosPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const access = useTodosAccess();
  const [tab, setTab] = useState<Tab>("due");
  const [editing, setEditing] = useState<Todo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const summary = useTodoSummary(access.canRead);
  const list = useTodos(TAB_PARAMS[tab], access.canRead);
  const { toggle, remove } = useTodoMutations();

  if (!access.canRead) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {t("todos.forbidden")}
      </p>
    );
  }
  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ListTodo className="text-primary size-6" />
            {t("todos.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("todos.description")}
          </p>
        </div>
        {access.canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("todos.actions.create")}
          </Button>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="due">
            {t("todos.tabs.due")}
            {summary.data && summary.data.overdue + summary.data.today > 0
              ? ` (${summary.data.overdue + summary.data.today})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="upcoming">{t("todos.tabs.upcoming")}</TabsTrigger>
          <TabsTrigger value="no_date">{t("todos.tabs.no_date")}</TabsTrigger>
          <TabsTrigger value="mine">
            {t("todos.tabs.mine")}
            {summary.data?.mine ? ` (${summary.data.mine})` : ""}
          </TabsTrigger>
          <TabsTrigger value="done">{t("todos.tabs.done")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="bg-card divide-y rounded-2xl border">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-6 py-10 text-center text-sm">
            {t("todos.empty")}
          </p>
        ) : (
          items.map((todo) => (
            <TodoItem
              key={todo.uuid}
              todo={todo}
              slug={slug}
              canWrite={access.canWrite}
              onToggle={(item, done) =>
                toggle.mutate({ uuid: item.uuid, done })
              }
              onEdit={(item) => {
                setEditing(item);
                setDialogOpen(true);
              }}
              onDelete={(item) => {
                if (window.confirm(t("todos.confirm_delete"))) {
                  remove.mutate(item.uuid);
                }
              }}
            />
          ))
        )}
      </div>

      <TodoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        todo={editing}
      />
    </div>
  );
}
