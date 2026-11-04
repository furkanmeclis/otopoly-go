/** Lead dialogs as bottom sheets: mark lost (web LostDialog) and todo-from-lead (web TodoFromLeadDialog). */
import { CalendarClock } from 'lucide-react-native';
import { useState } from 'react';

import { Button, DateField, Sheet, TextField, Txt } from '@/components/ui';
import { Chip, ChipRow } from '@/features/leads/components/crm-ui';
import { useLeadMutations } from '@/features/leads/queries';
import type { LeadDetail } from '@/features/leads/types';
import { localToday } from '@/features/jobs/lib/job-ui';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const LOST_PRESETS = ['price', 'competitor', 'no_response', 'not_needed'] as const;

export function LostSheet({ visible, onClose, onConfirm, pending }: { visible: boolean; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('leads.lost.title')}>
      <LostBody key={visible ? 'open' : 'closed'} onConfirm={onConfirm} pending={pending} />
    </Sheet>
  );
}

function LostBody({ onConfirm, pending }: { onConfirm: (reason: string) => void; pending: boolean }) {
  const { t: tr } = useLocale();
  const [reason, setReason] = useState('');
  return (
    <>
      <Txt tone="secondary">{tr('leads.lost.description')}</Txt>
      <ChipRow>
        {LOST_PRESETS.map((p) => {
          const label = tr(`leads.lost.presets.${p}`);
          return <Chip key={p} label={label} active={reason === label} onPress={() => setReason(label)} tone="danger" />;
        })}
      </ChipRow>
      <TextField label={tr('leads.lost_reason')} value={reason} onChangeText={setReason} multiline maxLength={500} />
      <Button variant="danger" size="lg" label={tr('leads.actions.mark_lost')} loading={pending} onPress={() => onConfirm(reason.trim())} />
    </>
  );
}

export function LeadTodoSheet({ lead, visible, onClose }: { lead: LeadDetail; visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('leads.todo.title')}>
      <LeadTodoBody key={visible ? 'open' : 'closed'} lead={lead} onClose={onClose} />
    </Sheet>
  );
}

function LeadTodoBody({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { createTodo } = useLeadMutations();
  const [title, setTitle] = useState(() => tr('leads.todo.default_title', { name: lead.customer_name }));
  const [due, setDue] = useState<string>(() => lead.follow_up_date ?? localToday());
  const errs = fieldErrors(createTodo.error);
  return (
    <>
      <Txt tone="secondary">{tr('leads.todo.description')}</Txt>
      <TextField label={tr('leads.todo.field_title')} value={title} onChangeText={setTitle} maxLength={200} required error={errs.title} />
      <DateField label={tr('leads.todo.field_due')} value={due || null} onChange={(v) => setDue(v ?? '')} allowClear error={errs.due_date} />
      <Button
        size="lg"
        label={createTodo.isPending ? tr('common.saving') : tr('leads.todo.submit')}
        icon={<CalendarClock size={18} color={t.colors.onPrimary} />}
        loading={createTodo.isPending}
        disabled={!title.trim()}
        onPress={() => createTodo.mutate({ uuid: lead.uuid, body: { title: title.trim(), due_date: due || null } }, { onSuccess: onClose })}
      />
    </>
  );
}
