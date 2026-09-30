/** Create / edit a todo (web `todos/components/todo-dialog.tsx`). */
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, DateField, SelectField, Sheet, TextField, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useTodoAssignees } from '@/features/queries';
import { ReminderPicker } from '@/features/todos/components/reminder-picker';
import { CustomerRefPicker, LeadRefPicker, QuoteRefPicker, type Ref } from '@/features/todos/components/ref-pickers';
import { useTodoMutations } from '@/features/todos/queries';
import type { Todo } from '@/features/todos/types';
import { createLogger } from '@/lib/logger';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.todo-form');

/** Prefill links for a new todo (e.g. from a lead / quote page). */
export type TodoLinkDefaults = {
  title?: string;
  customer?: Ref;
  lead?: Ref;
  quote?: Ref;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Edit this todo; create a new one when omitted. */
  todo?: Todo | null;
  defaultDueDate?: string;
  defaults?: TodoLinkDefaults;
};

export function TodoFormSheet(props: Props) {
  const { t: tr } = useLocale();
  const { todo, visible, onClose } = props;
  return (
    <Sheet visible={visible} onClose={onClose} title={todo ? tr('todos.dialog.edit_title') : tr('todos.dialog.create_title')}>
      {/* Re-key on open so every opening starts from the todo / defaults, never from stale edits. */}
      <TodoForm key={`${visible ? 'open' : 'closed'}:${todo?.uuid ?? 'new'}`} {...props} />
    </Sheet>
  );
}

function TodoForm({ onClose, todo, defaultDueDate, defaults }: Props) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const confirm = useConfirm();
  const assignees = useTodoAssignees();
  const { create, patch, remove } = useTodoMutations();
  const [title, setTitle] = useState(todo?.title ?? defaults?.title ?? '');
  const [notes, setNotes] = useState(todo?.notes ?? '');
  const [dueDate, setDueDate] = useState(todo?.due_date ?? defaultDueDate ?? '');
  const [dueTime, setDueTime] = useState(todo?.due_time ?? '');
  const [assignee, setAssignee] = useState(todo?.assignee?.uuid ?? '');
  const [customer, setCustomer] = useState<Ref | null>(todo ? todo.customer : (defaults?.customer ?? null));
  const [lead, setLead] = useState<Ref | null>(todo ? todo.lead : (defaults?.lead ?? null));
  const [quote, setQuote] = useState<Ref | null>(todo ? todo.quote : (defaults?.quote ?? null));
  const [reminders, setReminders] = useState<number[]>(todo?.reminder_offsets ?? []);
  const pending = create.isPending || patch.isPending;
  const errs = fieldErrors(todo ? patch.error : create.error);
  const canWrite = can(P.todosWrite);

  const submit = () => {
    if (!title.trim()) return;
    const body = {
      title: title.trim(),
      notes: notes.trim(),
      due_date: dueDate,
      due_time: dueDate ? dueTime : '',
      assignee_uuid: assignee,
      customer_uuid: customer?.uuid ?? '',
      lead_uuid: lead?.uuid ?? '',
      quote_uuid: quote?.uuid ?? '',
      reminder_offsets: dueDate ? reminders : [],
    };
    if (todo) {
      patch.mutate({ uuid: todo.uuid, body }, { onSuccess: onClose });
    } else {
      create.mutate(
        {
          title: body.title,
          notes: body.notes,
          due_date: body.due_date || null,
          due_time: body.due_time || null,
          assignee_uuid: body.assignee_uuid || null,
          customer_uuid: body.customer_uuid || null,
          lead_uuid: body.lead_uuid || null,
          quote_uuid: body.quote_uuid || null,
          reminder_offsets: body.reminder_offsets,
        },
        { onSuccess: onClose },
      );
    }
    log.info(todo ? 'Todo update submitted' : 'Todo create submitted', { uuid: todo?.uuid });
  };

  return (
    <>
      <TextField
        label={tr('todos.fields.title')}
        placeholder={tr('todos.dialog.title_placeholder')}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        autoFocus={!todo}
        required
        error={errs.title}
        returnKeyType="done"
      />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <DateField
            label={tr('todos.fields.due_date')}
            value={dueDate || null}
            onChange={(v) => {
              setDueDate(v ?? '');
              if (!v) setDueTime('');
            }}
            allowClear
            error={errs.due_date}
          />
        </View>
        {dueDate ? (
          <View style={{ width: 130 }}>
            <DateField label={tr('todos.fields.due_time')} mode="time" value={dueTime || null} onChange={(v) => setDueTime(v ?? '')} allowClear error={errs.due_time} />
          </View>
        ) : null}
      </View>
      <SelectField
        label={tr('todos.fields.assignee')}
        value={assignee || '__none__'}
        onChange={(v) => setAssignee(!v || v === '__none__' ? '' : v)}
        loading={assignees.isLoading}
        options={[{ value: '__none__', label: tr('todos.unassigned') }, ...(assignees.data ?? []).map((a) => ({ value: a.uuid, label: a.name }))]}
      />
      <ReminderPicker value={reminders} onChange={setReminders} disabled={!dueDate} hasTime={Boolean(dueTime)} />
      <CustomerRefPicker label={tr('todos.fields.customer')} placeholder={tr('todos.customer.placeholder')} value={customer} onChange={setCustomer} />
      <LeadRefPicker label={tr('todos.fields.lead')} placeholder={tr('todos.link.lead_placeholder')} value={lead} onChange={setLead} />
      <QuoteRefPicker label={tr('todos.fields.quote')} placeholder={tr('todos.link.quote_placeholder')} value={quote} onChange={setQuote} />
      <TextField label={tr('todos.fields.notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} error={errs.notes} />

      <View style={{ gap: t.spacing.sm, marginTop: t.spacing.sm }}>
        <Button
          size="lg"
          label={pending ? tr('common.saving') : todo ? tr('common.save') : tr('todos.actions.create')}
          loading={pending}
          disabled={!title.trim()}
          onPress={submit}
        />
        {todo && canWrite ? (
          <Button
            variant="outline"
            label={tr('todos.actions.delete')}
            icon={<Trash2 size={16} color={t.colors.danger} />}
            loading={remove.isPending}
            onPress={async () => {
              if (await confirm({ title: todo.title, message: tr('todos.confirm_delete'), destructive: true, confirmLabel: tr('common.delete') })) {
                remove.mutate(todo.uuid, { onSuccess: onClose });
              }
            }}
          />
        ) : null}
      </View>
    </>
  );
}
