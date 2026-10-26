/** Todos — web `/t/[slug]/todos` (`features/todos/components/todos-page.tsx`). */
import { router, useLocalSearchParams } from 'expo-router';
import { ListTodo, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, FilterChips, Group, Header, IconButton, ListSkeleton, SearchBar, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useTodosSummary } from '@/features/queries';
import { TodoFormSheet } from '@/features/todos/components/todo-form-sheet';
import { TodoRow } from '@/features/todos/components/todo-row';
import { useTodo, useTodoMutations, useTodosInfinite } from '@/features/todos/queries';
import type { Todo, TodoListParams } from '@/features/todos/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

type Tab = 'due' | 'upcoming' | 'no_date' | 'mine' | 'done';

const TAB_PARAMS: Record<Tab, TodoListParams> = {
  due: { status: 'open', scope: 'open_due' },
  upcoming: { status: 'open', scope: 'upcoming' },
  no_date: { status: 'open', scope: 'no_date' },
  mine: { status: 'open', assignee: 'me' },
  done: { status: 'done' },
};

export default function TodosScreen() {
  useLiveResource('tenant.todos');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.todosRead} title={tr('todos.title')}>
      <TodosList />
    </RequirePermission>
  );
}

function TodosList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(P.todosWrite);
  const params = useLocalSearchParams<{ todo?: string; customer?: string }>();
  const [tab, setTab] = useState<Tab>('due');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const summary = useTodosSummary();
  const list = useTodosInfinite({ ...TAB_PARAMS[tab], customer: params.customer || undefined, q: query || undefined });
  const { remove } = useTodoMutations();
  const [editing, setEditing] = useState<Todo | null>(null);
  const [creating, setCreating] = useState(false);
  // Deep link from reminder notifications: /todos?todo={uuid}
  const linked = useTodo(params.todo);
  const [dismissedLink, setDismissedLink] = useState<string | null>(null);
  const linkedTodo = linked.data && params.todo !== dismissedLink ? linked.data : null;
  const s = summary.data;
  const dueCount = s ? s.overdue + s.today : 0;

  const closeSheet = () => {
    if (linkedTodo) {
      setDismissedLink(params.todo ?? null);
      router.setParams({ todo: undefined });
    }
    setCreating(false);
    setEditing(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('todos.title')}
        subtitle={s ? `${tr('todos.nav.open')}: ${s.open}${s.overdue ? ` · ${tr('todos.nav.overdue')}: ${s.overdue}` : ''}` : tr('todos.description')}
        right={
          canWrite ? (
            <IconButton
              variant="primary"
              label={tr('todos.actions.create')}
              icon={<Plus size={20} color={t.colors.onPrimary} />}
              onPress={() => {
                setEditing(null);
                setCreating(true);
              }}
            />
          ) : undefined
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.md }}>
            <SearchBar value={q} onChangeText={setQ} />
            <FilterChips<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'due', label: tr('todos.tabs.due'), count: dueCount > 0 ? dueCount : undefined },
                { value: 'upcoming', label: tr('todos.tabs.upcoming') },
                { value: 'no_date', label: tr('todos.tabs.no_date') },
                { value: 'mine', label: tr('todos.tabs.mine'), count: s?.mine ? s.mine : undefined },
                { value: 'done', label: tr('todos.tabs.done') },
              ]}
            />
            {params.customer ? (
              <Txt variant="caption" tone="secondary">
                {tr('todos.fields.customer')} ·{' '}
                <Txt variant="caption" tone="primary" onPress={() => router.setParams({ customer: undefined })} accessibilityRole="button">
                  {tr('common.clear')}
                </Txt>
              </Txt>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === list.items.length - 1;
          return (
            <View
              style={{
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: first ? 1 : 0,
                borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: first ? t.radius.lg : 0,
                borderTopRightRadius: first ? t.radius.lg : 0,
                borderBottomLeftRadius: last ? t.radius.lg : 0,
                borderBottomRightRadius: last ? t.radius.lg : 0,
                overflow: 'hidden',
              }}
            >
              <TodoRow
                todo={item}
                canWrite={canWrite}
                showNotes
                last={last}
                onPress={canWrite ? () => setEditing(item) : undefined}
                onLongPress={
                  canWrite
                    ? async () => {
                        if (await confirm({ title: item.title, message: tr('todos.confirm_delete'), destructive: true, confirmLabel: tr('todos.actions.delete') })) remove.mutate(item.uuid);
                      }
                    : undefined
                }
              />
            </View>
          );
        }}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              list.refetch();
              summary.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={60} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <Group>
              <EmptyState
                icon={<ListTodo size={28} color={t.colors.textMuted} />}
                title={tr('todos.empty')}
                description={tr('todos.description')}
                action={canWrite && !q ? <Button size="sm" label={tr('todos.actions.create')} onPress={() => setCreating(true)} /> : undefined}
              />
            </Group>
          )
        }
      />
      <TodoFormSheet visible={creating || editing !== null || Boolean(linkedTodo)} onClose={closeSheet} todo={linkedTodo ?? editing} />
    </SafeAreaView>
  );
}
