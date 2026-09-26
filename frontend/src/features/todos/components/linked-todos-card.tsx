"use client";

import { ListTodo, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import {
  TodoDialog,
  type TodoLinkDefaults,
} from "@/features/todos/components/todo-dialog";
import { TodoItem } from "@/features/todos/components/todo-item";
import {
  useTodoMutations,
  useTodos,
  useTodosAccess,
} from "@/features/todos/hooks/use-todos";
import type { Todo } from "@/features/todos/types";
import { useLocale } from "@/providers/locale-provider";

type LinkedTodosCardProps = {
  slug: string;
  /** Filter: todos linked to this lead / quote (uuid). */
  lead?: string;
  quote?: string;
  /** Prefill for "add todo" when onAdd is not given. */
  defaults?: TodoLinkDefaults;
  /** Custom "add todo" flow (e.g. the lead's own todo dialog). */
  onAdd?: () => void;
};

/** "Görevler" card on lead / quote detail pages. */
export function LinkedTodosCard({
  slug,
  lead,
  quote,
  defaults,
  onAdd,
}: LinkedTodosCardProps) {
  const { t } = useLocale();
  const access = useTodosAccess();
  const list = useTodos({ lead, quote, limit: 20 }, access.canRead);
  const { toggle } = useTodoMutations();
  const [editing, setEditing] = useState<Todo | null>(null);
  const [creating, setCreating] = useState(false);

  if (!access.canRead) return null;
  const items = list.data?.items ?? [];
  const openCount = items.filter((x) => x.status === "open").length;

  return (
    <section className="bg-card rounded-2xl border">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="size-4" />
          {t("todos.linked.title")}
          {openCount > 0 ? (
            <span className="text-muted-foreground text-xs font-normal">
              ({openCount})
            </span>
          ) : null}
        </h2>
        {access.canWrite ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => (onAdd ? onAdd() : setCreating(true))}
          >
            <Plus className="size-4" />
            {t("todos.linked.add")}
          </Button>
        ) : null}
      </div>
      {list.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground px-4 py-5 text-center text-sm">
          {t("todos.linked.empty")}
        </p>
      ) : (
        <div className="divide-y">
          {items.map((todo) => (
            <TodoItem
              key={todo.uuid}
              todo={todo}
              slug={slug}
              canWrite={access.canWrite}
              compact
              onToggle={(x, done) => toggle.mutate({ uuid: x.uuid, done })}
              onEdit={setEditing}
            />
          ))}
          {list.data && list.data.total > items.length ? (
            <Link
              href={routes.tenant.todos.root(slug)}
              className="text-primary block px-4 py-2 text-center text-xs hover:underline"
            >
              {t("todos.widget.all")}
            </Link>
          ) : null}
        </div>
      )}
      <TodoDialog
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        todo={editing}
        defaults={defaults}
      />
    </section>
  );
}
