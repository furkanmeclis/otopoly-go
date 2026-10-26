/**
 * Assistant → conversation list (GET /v1/tenant/ai/conversations, search with `q`). Tap opens the
 * conversation, long press (or the "more" button) renames / deletes it, "New chat" starts one. The empty
 * state offers suggested questions that open a new chat and send right away. Old links with `?c=<uuid>`
 * (web address) go straight to that conversation.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { MessageSquareText, MoreHorizontal, Sparkles, SquarePen } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, Header, IconButton, ListSkeleton, Screen, SearchBar, Txt } from '@/components/ui';
import { AssistantGate, useAssistantAccess } from '@/features/ai/components/assistant-gate';
import { useConversationActions } from '@/features/ai/components/conversation-actions';
import { SUGGESTION_KEYS } from '@/features/ai/lib/labels';
import { useConversationList } from '@/features/ai/queries';
import type { AIConversation } from '@/features/ai/types';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function AssistantListScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.aiUse} title={tr('ai.assistant.title')}>
      <AssistantList />
    </RequirePermission>
  );
}

const openChat = (uuid: string) => router.push({ pathname: '/assistant/[id]', params: { id: uuid } });
const newChat = (prompt?: string) => router.push({ pathname: '/assistant/[id]', params: prompt ? { id: 'new', prompt } : { id: 'new' } });

function AssistantList() {
  const theme = useTheme();
  const { t: tr } = useLocale();
  const access = useAssistantAccess();
  const { c } = useLocalSearchParams<{ c?: string }>();

  // Web address `/assistant?c=<uuid>`: open that conversation on top of the list.
  useEffect(() => {
    if (typeof c === 'string' && c) {
      router.setParams({ c: '' });
      openChat(c);
    }
  }, [c]);

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('ai.assistant.title')}
          right={access.ready ? <IconButton label={tr('ai.assistant.new_chat')} icon={<SquarePen size={20} color={theme.colors.text} />} onPress={() => newChat()} /> : undefined}
        />
      }
    >
      <AssistantGate access={access}>{() => <ConversationList />}</AssistantGate>
    </Screen>
  );
}

function ConversationList() {
  const t = useTheme();
  const { t: tr, fmt, tp } = useLocale();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const query = q.trim();
  const list = useConversationList(query);
  const actions = useConversationActions();
  const [refreshing, setRefreshing] = useState(false);
  const items = list.data?.items ?? [];
  const searching = query.length > 0;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }, [list]);

  const renderItem = useCallback(
    ({ item, index }: { item: AIConversation; index: number }) => (
      <ConversationRow conv={item} first={index === 0} last={index === items.length - 1} onMore={actions.open} subtitle={`${tp('mobile.ai.list.messages', item.message_count)} · ${fmt.relative(item.last_message_at ?? item.updated_at ?? item.created_at)}`} />
    ),
    [actions.open, fmt, items.length, tp],
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm }}>
        <SearchBar value={q} onChangeText={setQ} placeholder={tr('ai.assistant.search')} />
      </View>
      {list.isLoading ? (
        <View style={{ padding: t.spacing.lg }}>
          <ListSkeleton rows={5} height={64} />
        </View>
      ) : list.isError ? (
        <ErrorState error={list.error} description={tr('mobile.ai.list.load_failed')} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.uuid}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: insets.bottom + 96, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={t.colors.primary} colors={[t.colors.primary]} />}
          ListEmptyComponent={searching ? <EmptyState title={tr('mobile.ai.list.no_results')} description={tr('mobile.ai.list.no_results_body', { q: query })} /> : <ListEmpty />}
        />
      )}
      {items.length > 0 ? (
        <View style={{ position: 'absolute', left: t.spacing.lg, right: t.spacing.lg, bottom: Math.max(insets.bottom, t.spacing.md) }}>
          <Button label={tr('ai.assistant.new_chat')} icon={<SquarePen size={18} color={t.colors.onPrimary} />} onPress={() => newChat()} size="lg" fullWidth />
        </View>
      ) : null}
      {actions.sheet}
    </View>
  );
}

function ConversationRow({ conv, first, last, subtitle, onMore }: { conv: AIConversation; first: boolean; last: boolean; subtitle: string; onMore: (conv: AIConversation) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const title = conv.title || tr('ai.assistant.untitled');
  return (
    <Pressable
      onPress={() => openChat(conv.uuid)}
      onLongPress={() => onMore(conv)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityHint={tr('mobile.ai.list.row_hint')}
      accessibilityActions={[
        { name: 'activate', label: tr('mobile.ai.list.open') },
        { name: 'longpress', label: tr('mobile.ai.list.manage') },
      ]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onMore(conv) : openChat(conv.uuid))}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingLeft: t.spacing.lg,
        paddingRight: t.spacing.sm,
        paddingVertical: t.spacing.md,
        minHeight: 64,
        backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
        borderColor: t.colors.border,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: 1,
        borderTopLeftRadius: first ? t.radius.lg : 0,
        borderTopRightRadius: first ? t.radius.lg : 0,
        borderBottomLeftRadius: last ? t.radius.lg : 0,
        borderBottomRightRadius: last ? t.radius.lg : 0,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <MessageSquareText size={18} color={t.colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Txt>
      </View>
      <IconButton variant="ghost" label={tr('mobile.ai.list.manage_named', { title })} icon={<MoreHorizontal size={18} color={t.colors.textSecondary} />} onPress={() => onMore(conv)} />
    </Pressable>
  );
}

function ListEmpty() {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.lg, paddingVertical: t.spacing.xxxl, paddingHorizontal: t.spacing.md }}>
      <View style={{ width: 56, height: 56, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Sparkles size={28} color={t.colors.primary} />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Txt variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
          {tr('mobile.ai.list.empty_title')}
        </Txt>
        <Txt tone="secondary" style={{ textAlign: 'center' }}>
          {tr('mobile.ai.list.empty_body')}
        </Txt>
      </View>
      <View style={{ alignSelf: 'stretch', gap: t.spacing.sm }}>
        {SUGGESTION_KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => newChat(tr(key))}
            accessibilityRole="button"
            accessibilityHint={tr('mobile.ai.list.suggestion_hint')}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
              borderRadius: t.radius.md,
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.md,
              minHeight: 48,
              justifyContent: 'center',
            })}
          >
            <Txt>{tr(key)}</Txt>
          </Pressable>
        ))}
      </View>
      <Button label={tr('ai.assistant.new_chat')} icon={<SquarePen size={18} color={t.colors.onPrimary} />} onPress={() => newChat()} />
    </View>
  );
}
