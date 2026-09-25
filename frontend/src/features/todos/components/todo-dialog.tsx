"use client";

import { useCallback, useState } from "react";

import {
  AsyncCombobox,
  type ComboboxOption,
} from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { customersService } from "@/features/customers/services/customers.service";
import { ReminderPicker } from "@/features/todos/components/reminder-picker";
import {
  useTodoAssignees,
  useTodoMutations,
} from "@/features/todos/hooks/use-todos";
import type { Todo } from "@/features/todos/types";
import { useLocale } from "@/providers/locale-provider";

const NONE = "__none__";

type TodoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this todo; create a new one when omitted. */
  todo?: Todo | null;
  defaultDueDate?: string;
};

export function TodoDialog(props: TodoDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <TodoForm {...props} /> : null}
    </Dialog>
  );
}

function TodoForm({ onOpenChange, todo, defaultDueDate }: TodoDialogProps) {
  const { t } = useLocale();
  const assignees = useTodoAssignees();
  const { create, patch } = useTodoMutations();
  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [dueDate, setDueDate] = useState(
    todo?.due_date ?? defaultDueDate ?? "",
  );
  const [dueTime, setDueTime] = useState(todo?.due_time ?? "");
  const [assignee, setAssignee] = useState(todo?.assignee?.uuid ?? "");
  const [customer, setCustomer] = useState(todo?.customer?.uuid ?? "");
  const [reminders, setReminders] = useState<number[]>(
    todo?.reminder_offsets ?? [],
  );
  const pending = create.isPending || patch.isPending;
  const initialCustomer: ComboboxOption[] = todo?.customer
    ? [{ value: todo.customer.uuid, label: todo.customer.label }]
    : [];
  const loadCustomers = useCallback(async (q: string) => {
    const page = await customersService.list({
      q: q.trim() || undefined,
      limit: 20,
      offset: 0,
      is_active: "true",
    });
    return page.items.map((c) => ({
      value: c.uuid,
      label: c.phone ? `${c.name} · ${c.phone}` : c.name,
    }));
  }, []);

  const submit = async () => {
    const body = {
      title: title.trim(),
      notes: notes.trim(),
      due_date: dueDate,
      due_time: dueDate ? dueTime : "",
      assignee_uuid: assignee,
      customer_uuid: customer,
      reminder_offsets: dueDate ? reminders : [],
    };
    if (todo) {
      await patch.mutateAsync({ uuid: todo.uuid, body });
    } else {
      await create.mutateAsync({
        title: body.title,
        notes: body.notes,
        due_date: body.due_date || null,
        due_time: body.due_time || null,
        assignee_uuid: body.assignee_uuid || null,
        customer_uuid: body.customer_uuid || null,
        reminder_offsets: body.reminder_offsets,
      });
    }
    onOpenChange(false);
  };

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {todo ? t("todos.dialog.edit_title") : t("todos.dialog.create_title")}
        </DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) void submit().catch(() => undefined);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="todo-title">{t("todos.fields.title")}</Label>
          <Input
            id="todo-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
            placeholder={t("todos.dialog.title_placeholder")}
          />
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-date">{t("todos.fields.due_date")}</Label>
            <DatePicker id="todo-date" value={dueDate} onChange={setDueDate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-time">{t("todos.fields.due_time")}</Label>
            <Input
              id="todo-time"
              type="time"
              value={dueTime}
              disabled={!dueDate}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="todo-assignee">{t("todos.fields.assignee")}</Label>
          <Select
            value={assignee || NONE}
            onValueChange={(v) => setAssignee(v === NONE ? "" : v)}
          >
            <SelectTrigger id="todo-assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("todos.unassigned")}</SelectItem>
              {(assignees.data ?? []).map((a) => (
                <SelectItem key={a.uuid} value={a.uuid}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("todos.fields.reminders")}</Label>
          <ReminderPicker
            value={reminders}
            onChange={setReminders}
            disabled={!dueDate}
            hasTime={Boolean(dueTime)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="todo-customer">{t("todos.fields.customer")}</Label>
          <AsyncCombobox
            id="todo-customer"
            value={customer}
            onValueChange={setCustomer}
            loadOptions={loadCustomers}
            initialOptions={initialCustomer}
            clearable
            placeholder={t("todos.customer.placeholder")}
            searchPlaceholder={t("todos.customer.search")}
            emptyText={t("todos.customer.empty")}
          />
        </div>
        {todo?.lead || todo?.quote ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {todo.lead ? (
              <Badge variant="outline">
                {t("todos.fields.lead")}: {todo.lead.label}
              </Badge>
            ) : null}
            {todo.quote ? (
              <Badge variant="outline">
                {t("todos.fields.quote")}: {todo.quote.label}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="todo-notes">{t("todos.fields.notes")}</Label>
          <Textarea
            id="todo-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={pending || !title.trim()}>
            {todo ? t("common.save") : t("todos.actions.create")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
