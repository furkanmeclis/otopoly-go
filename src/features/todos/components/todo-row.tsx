import * as Haptics from 'expo-haptics';
import { BellRing, Briefcase, CheckCircle2, Circle, Clock, FileText, Sparkles, Target, UserRound, Users } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Row, Txt } from '@/components/ui';
import { qk } from '@/features/queries';
import { todosService } from '@/features/todos/services/todos.service';
import type { Todo } from '@/features/todos/types';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export function useTodoDueLabel() {
  const { t, fmt } = useLocale();
  return (todo: Todo) => {
    if (!todo.due_date) return null;
    const today = localToday();
    const day =
      todo.due_date === today
        ? t('todos.due.today')
        : todo.due_date === shiftDate(today, 1)
          ? t('todos.due.tomorrow')
          : todo.due_date === shiftDate(today, -1)
            ? t('todos.due.yesterday')
            : fmt.date(`${todo.due_date}T12:00:00`, 'short');
    return todo.due_time ? `${day} ${todo.due_time}` : day;
  };
}

/** Small inline meta item (icon + caption). */
function Meta({ icon, label, tone = 'muted', strong }: { icon: ReactNode; label: string; tone?: 'muted' | 'danger' | 'warning' | 'primary'; strong?: boolean }) {
  return (
    <Row gap={4} style={{ maxWidth: '100%' }}>
      {icon}
      <Txt variant="caption" tone={tone} numberOfLines={1} style={{ fontWeight: strong ? '700' : '500', flexShrink: 1 }}>
        {label}
      </Txt>
    </Row>
  );
}

/**
 * One todo (web `todo-item.tsx`). Tapping the circle completes / reopens it.
 * Existing callers (dashboard, customer detail) only pass `todo/canWrite/onPress/last`;
 * `onLongPress`, `showNotes` and `showLinks` are optional additions for the todos screen.
 */
export function TodoRow({
  todo,
  canWrite,
  onPress,
  onLongPress,
  last,
  showNotes = false,
  showLinks = true,
}: {
  todo: Todo;
  canWrite: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  last?: boolean;
  showNotes?: boolean;
  showLinks?: boolean;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const dueLabel = useTodoDueLabel();
  const done = todo.status === 'done';
  const toggle = useApiMutation({
    key: done ? 'todos.reopen' : 'todos.complete',
    fn: () => (done ? todosService.reopen(todo.uuid) : todosService.complete(todo.uuid)),
    invalidate: [qk.todos, qk.leads, qk.quotes],
    toastValidation: true,
  });
  const due = dueLabel(todo);
  const dueToday = todo.status === 'open' && todo.due_date === localToday();
  const dueTone = todo.overdue ? 'danger' : dueToday ? 'warning' : 'muted';
  const dueColor = todo.overdue ? t.colors.danger : dueToday ? t.colors.warning : t.colors.textMuted;
  const muted = t.colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole="button"
      accessibilityLabel={todo.title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
        backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
      })}
    >
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          toggle.mutate(undefined);
        }}
        disabled={!canWrite || toggle.isPending}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: !canWrite }}
        accessibilityLabel={done ? tr('todos.actions.reopen') : tr('todos.actions.complete')}
      >
        {done ? <CheckCircle2 size={22} color={t.colors.success} /> : <Circle size={22} color={todo.overdue ? t.colors.danger : t.colors.borderStrong} />}
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt variant="bodyStrong" tone={done ? 'muted' : 'default'} style={done ? { textDecorationLine: 'line-through' } : undefined} numberOfLines={2}>
          {todo.title}
        </Txt>
        <Row gap={10} wrap>
          {due ? <Meta icon={<Clock size={12} color={dueColor} />} label={due} tone={dueTone} strong={todo.overdue} /> : null}
          {todo.assignee ? <Meta icon={<UserRound size={12} color={muted} />} label={todo.assignee.label} /> : null}
          {showLinks && todo.customer ? <Meta icon={<Users size={12} color={muted} />} label={todo.customer.label} /> : null}
          {showLinks && todo.job ? <Meta icon={<Briefcase size={12} color={muted} />} label={todo.job.label} /> : null}
          {showLinks && todo.lead ? <Meta icon={<Target size={12} color={muted} />} label={todo.lead.label} /> : null}
          {showLinks && todo.quote ? <Meta icon={<FileText size={12} color={muted} />} label={todo.quote.label} /> : null}
          {todo.next_reminder_at && !done ? <Meta icon={<BellRing size={12} color={muted} />} label={`${fmt.date(todo.next_reminder_at, 'short')} ${fmt.time(todo.next_reminder_at)}`} /> : null}
          {todo.via_ai ? <Meta icon={<Sparkles size={12} color={t.colors.primary} />} label={tr('todos.via_ai_short')} tone="primary" /> : null}
        </Row>
        {showNotes && todo.notes ? (
          <Txt variant="caption" tone="secondary" numberOfLines={3}>
            {todo.notes}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}
