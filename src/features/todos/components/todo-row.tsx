import * as Haptics from 'expo-haptics';
import { CheckCircle2, Circle, Clock, Link2, UserRound } from 'lucide-react-native';
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

export function TodoRow({ todo, canWrite, onPress, last }: { todo: Todo; canWrite: boolean; onPress?: () => void; last?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const dueLabel = useTodoDueLabel();
  const done = todo.status === 'done';
  const toggle = useApiMutation({
    key: done ? 'todos.reopen' : 'todos.complete',
    fn: () => (done ? todosService.reopen(todo.uuid) : todosService.complete(todo.uuid)),
    invalidate: [qk.todos],
    toastValidation: true,
  });
  const due = dueLabel(todo);
  const link = todo.customer?.label ?? todo.lead?.label ?? todo.quote?.label ?? todo.job?.label;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
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
          {due ? (
            <Row gap={4}>
              <Clock size={12} color={todo.overdue ? t.colors.danger : t.colors.textMuted} />
              <Txt variant="caption" tone={todo.overdue ? 'danger' : 'muted'} style={{ fontWeight: todo.overdue ? '700' : '500' }}>
                {due}
              </Txt>
            </Row>
          ) : null}
          {todo.assignee ? (
            <Row gap={4}>
              <UserRound size={12} color={t.colors.textMuted} />
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {todo.assignee.label}
              </Txt>
            </Row>
          ) : null}
          {link ? (
            <Row gap={4}>
              <Link2 size={12} color={t.colors.textMuted} />
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {link}
              </Txt>
            </Row>
          ) : null}
        </Row>
      </View>
    </Pressable>
  );
}
