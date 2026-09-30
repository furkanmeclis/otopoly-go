import { router, useLocalSearchParams } from 'expo-router';
import { History, MoreHorizontal, SquarePen } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, Header, IconButton, ListRow, ListSkeleton, Screen, SearchBar, Sheet, TextField, Txt, useConfirm } from '@/components/ui';
import { ChatEmpty, Composer, MessageBubble } from '@/features/ai/components/chat';
import { unavailableKey } from '@/features/ai/lib/labels';
import { useAIStatus, useAssistantChat, useConversationList, useDeleteConversation, useRenameConversation } from '@/features/ai/queries';
import type { AIConversation, AIStatus, ChatMessage } from '@/features/ai/types';
import { isFeatureDisabled } from '@/api/errors';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.assistant');

export default function AssistantScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.aiUse} title={tr('ai.assistant.title')}>
      <Assistant />
    </RequirePermission>
  );
}

function Assistant() {
  const theme = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const status = useAIStatus(can(P.aiUse));
  const { c } = useLocalSearchParams<{ c?: string }>();
  const conversation = typeof c === 'string' && c ? c : null;
  const [historyOpen, setHistoryOpen] = useState(false);

  // Bumped on explicit navigation (history / new chat) so the chat remounts; a conversation created by
  // the first message only updates the URL and keeps the live chat mounted.
  const [selected, setSelected] = useState<{ key: number; uuid: string | null }>({ key: 0, uuid: conversation });
  const select = useCallback((uuid: string | null) => {
    router.setParams({ c: uuid ?? '' });
    setSelected((cur) => ({ key: cur.key + 1, uuid }));
  }, []);
  const onCreated = useCallback((uuid: string) => router.setParams({ c: uuid }), []);

  const locked = status.data?.plan_enabled === false || isFeatureDisabled(status.error);
  const ready = status.data?.available && !locked;

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('ai.assistant.title')}
          right={
            ready ? (
              <>
                <IconButton label={tr('ai.assistant.history')} icon={<History size={20} color={theme.colors.text} />} onPress={() => setHistoryOpen(true)} />
                <IconButton label={tr('ai.assistant.new_chat')} icon={<SquarePen size={20} color={theme.colors.text} />} onPress={() => select(null)} />
              </>
            ) : undefined
          }
        />
      }
    >
      {status.isLoading ? (
        <View style={{ padding: 16 }}>
          <ListSkeleton rows={4} height={64} />
        </View>
      ) : locked ? (
        <FeatureLockedState feature="ai.enabled" />
      ) : status.isError ? (
        <ErrorState onRetry={() => void status.refetch()} />
      ) : !ready ? (
        <EmptyState title={tr('ai.unavailable.title')} description={tr(unavailableKey(status.data?.reason))} />
      ) : (
        <Chat key={selected.key} conversation={selected.uuid} status={status.data ?? null} onConversationCreated={onCreated} />
      )}
      <HistorySheet visible={historyOpen} onClose={() => setHistoryOpen(false)} active={selected.uuid} onSelect={select} />
    </Screen>
  );
}

function Chat({ conversation, status, onConversationCreated }: { conversation: string | null; status: AIStatus | null; onConversationCreated: (uuid: string) => void }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [convUuid, setConvUuid] = useState(conversation);
  const chat = useAssistantChat({
    conversationUuid: convUuid,
    onConversationCreated: (uuid) => {
      setConvUuid(uuid);
      onConversationCreated(uuid);
    },
  });
  const quota = status?.quota;
  const showQuota = quota && !quota.unlimited && quota.limit > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {chat.loadError ? (
        <ErrorState description={tr('ai.assistant.load_failed')} onRetry={() => void chat.refetch()} />
      ) : chat.loading && convUuid ? (
        <View style={{ padding: t.spacing.lg }}>
          <ListSkeleton rows={3} height={56} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={chat.messages}
          keyExtractor={(m) => m.uuid}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, flexGrow: 1 }}
          ListEmptyComponent={<ChatEmpty onPick={(text) => void chat.send(text)} disabled={chat.busy} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
      )}
      <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: Math.max(insets.bottom, t.spacing.sm), borderTopWidth: 1, borderTopColor: t.colors.border, backgroundColor: t.colors.background, gap: 6 }}>
        <Composer onSend={(text) => void chat.send(text)} onStop={chat.stop} busy={chat.busy} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: t.spacing.md }}>
          <Txt variant="caption" tone="muted" style={{ fontSize: 11, flexShrink: 1 }}>
            {tr('ai.assistant.disclaimer')}
          </Txt>
          {showQuota ? (
            <Txt variant="caption" tone="muted" style={{ fontSize: 11 }}>
              {tr('ai.assistant.quota_left', { remaining: quota.remaining.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US') })}
            </Txt>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function HistorySheet({ visible, onClose, active, onSelect }: { visible: boolean; onClose: () => void; active: string | null; onSelect: (uuid: string | null) => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const list = useConversationList(q.trim(), visible);
  const rename = useRenameConversation();
  const remove = useDeleteConversation((uuid) => {
    if (uuid === active) onSelect(null);
  });
  const [renaming, setRenaming] = useState<AIConversation | null>(null);
  const [title, setTitle] = useState('');
  const items = list.data?.items ?? [];

  const askDelete = async (conv: AIConversation) => {
    if (await confirm({ title: tr('ai.assistant.delete_title'), message: tr('ai.assistant.delete_description'), destructive: true, confirmLabel: tr('ai.assistant.delete'), cancelLabel: tr('ai.assistant.cancel') })) {
      log.info('Delete conversation', { uuid: conv.uuid });
      remove.mutate(conv.uuid);
    }
  };
  const startRename = (conv: AIConversation) => {
    setTitle(conv.title);
    setRenaming(conv);
  };
  const openActions = (conv: AIConversation) => {
    const labels = [tr('ai.assistant.rename'), tr('ai.assistant.delete'), tr('ai.assistant.cancel')];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: labels, destructiveButtonIndex: 1, cancelButtonIndex: 2, title: conv.title || tr('ai.assistant.untitled') }, (i) => {
        if (i === 0) startRename(conv);
        if (i === 1) void askDelete(conv);
      });
    } else {
      Alert.alert(conv.title || tr('ai.assistant.untitled'), undefined, [
        { text: labels[2], style: 'cancel' },
        { text: labels[1], style: 'destructive', onPress: () => void askDelete(conv) },
        { text: labels[0], onPress: () => startRename(conv) },
      ]);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('ai.assistant.history')}>
      <Button
        label={tr('ai.assistant.new_chat')}
        variant="outline"
        icon={<SquarePen size={18} color={t.colors.text} />}
        onPress={() => {
          onSelect(null);
          onClose();
        }}
      />
      <SearchBar value={q} onChangeText={setQ} placeholder={tr('ai.assistant.search')} />
      {list.isLoading ? (
        <ListSkeleton rows={4} height={56} />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={tr('ai.assistant.history_empty')} />
      ) : (
        <View style={{ borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border }}>
          {items.map((conv, i) => (
            <ListRow
              key={conv.uuid}
              title={conv.title || tr('ai.assistant.untitled')}
              subtitle={fmt.relative(conv.last_message_at ?? conv.created_at)}
              chevron={false}
              right={
                <IconButton label={tr('ai.assistant.rename')} variant="ghost" icon={<MoreHorizontal size={18} color={t.colors.textSecondary} />} onPress={() => openActions(conv)} />
              }
              onPress={() => {
                onSelect(conv.uuid);
                onClose();
              }}
              last={i === items.length - 1}
              accessibilityLabel={`${conv.title || tr('ai.assistant.untitled')}${conv.uuid === active ? ' ✓' : ''}`}
            />
          ))}
        </View>
      )}
      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} title={tr('ai.assistant.rename_title')} footer={
        <Button
          label={tr('ai.assistant.save')}
          loading={rename.isPending}
          disabled={!title.trim()}
          onPress={() => {
            const target = renaming;
            setRenaming(null);
            if (target && title.trim()) rename.mutate({ uuid: target.uuid, title: title.trim() });
          }}
        />
      }>
        <TextField label={tr('ai.assistant.rename_label')} value={title} onChangeText={setTitle} placeholder={renaming?.title || tr('ai.assistant.rename_label')} autoFocus maxLength={120} />
      </Sheet>
    </Sheet>
  );
}
