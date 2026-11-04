/** "Görevler" section on lead / quote detail screens (web `linked-todos-card.tsx`). */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Group, Section, Skeleton, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useTodos } from '@/features/queries';
import { TodoFormSheet, type TodoLinkDefaults } from '@/features/todos/components/todo-form-sheet';
import { TodoRow } from '@/features/todos/components/todo-row';
import type { Todo } from '@/features/todos/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export function LinkedTodos({ lead, quote, defaults, onAdd }: { lead?: string; quote?: string; defaults?: TodoLinkDefaults; onAdd?: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const canRead = can(P.todosRead);
  const canWrite = can(P.todosWrite);
  const list = useTodos({ lead, quote, limit: 20 }, canRead);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [creating, setCreating] = useState(false);
  if (!canRead) return null;
  const items = list.data?.items ?? [];
  const openCount = items.filter((x) => x.status === 'open').length;

  return (
    <Section
      title={openCount > 0 ? `${tr('todos.linked.title')} (${openCount})` : tr('todos.linked.title')}
      action={canWrite ? { label: tr('todos.linked.add'), onPress: () => (onAdd ? onAdd() : setCreating(true)) } : undefined}
    >
      <Group>
        {list.isLoading ? (
          <View style={{ padding: t.spacing.lg }}>
            <Skeleton height={44} />
          </View>
        ) : items.length === 0 ? (
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
            {tr('todos.linked.empty')}
          </Txt>
        ) : (
          items.map((todo, i) => (
            <TodoRow key={todo.uuid} todo={todo} canWrite={canWrite} onPress={canWrite ? () => setEditing(todo) : undefined} last={i === items.length - 1 && !(list.data && list.data.total > items.length)} />
          ))
        )}
        {list.data && list.data.total > items.length ? (
          <Txt tone="primary" variant="caption" style={{ padding: t.spacing.md, textAlign: 'center', fontWeight: '700' }} onPress={() => router.push('/todos')} accessibilityRole="link">
            {tr('todos.widget.all')}
          </Txt>
        ) : null}
      </Group>
      <TodoFormSheet
        visible={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        todo={editing}
        defaults={defaults}
      />
    </Section>
  );
}
