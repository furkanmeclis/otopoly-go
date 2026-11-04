/**
 * Assistant → one conversation (`/assistant/<uuid>`), or a new one (`/assistant/new`, optional `prompt`
 * that is sent right away). The first message of a new chat creates the conversation and the route
 * param switches to its uuid without remounting the live chat.
 *
 * Keyboard: the shared KeyboardAvoider (keyboard-controller) is the route's root view on both platforms, so
 * the composer rides on the keyboard; the composer drops the home-indicator inset while the keyboard is up.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { MoreHorizontal, SquarePen } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Header, IconButton, KeyboardAvoider, ListSkeleton, Txt } from '@/components/ui';
import { ChatActionsProvider } from '@/features/ai/components/action-blocks';
import { AssistantGate, useAssistantAccess } from '@/features/ai/components/assistant-gate';
import { ChatEmpty, Composer, MessageBubble } from '@/features/ai/components/chat';
import { useConversationActions } from '@/features/ai/components/conversation-actions';
import { useAssistantChat, useConversationDetail } from '@/features/ai/queries';
import type { AIStatus, ChatMessage } from '@/features/ai/types';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const NEW = 'new';

export default function AssistantConversationScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.aiUse} title={tr('ai.assistant.title')}>
      <Conversation />
    </RequirePermission>
  );
}

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function Conversation() {
  const theme = useTheme();
  const { t: tr } = useLocale();
  const params = useLocalSearchParams<{ id: string; prompt?: string; n?: string }>();
  const routeId = typeof params.id === 'string' && params.id !== NEW ? params.id : null;
  const nonce = typeof params.n === 'string' ? params.n : '';
  // Fixed until "New chat" (new `n`): a conversation created by the first message only updates the URL.
  const [initial, setInitial] = useState(() => ({ nonce, uuid: routeId, prompt: typeof params.prompt === 'string' ? params.prompt : '' }));
  if (initial.nonce !== nonce) setInitial({ nonce, uuid: routeId, prompt: '' });
  const access = useAssistantAccess();
  const detail = useConversationDetail(routeId);
  const actions = useConversationActions({ onDeleted: (uuid) => uuid === routeId && router.back() });
  const title = routeId ? detail.data?.title || tr('ai.assistant.untitled') : tr('ai.assistant.new_chat');

  const onCreated = useCallback((uuid: string) => router.setParams({ id: uuid, prompt: '' }), []);

  return (
    <KeyboardAvoider style={{ backgroundColor: theme.colors.background }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Header
          title={title}
          right={
            access.ready ? (
              <>
                {routeId ? (
                  <IconButton label={tr('mobile.ai.list.manage_named', { title })} icon={<MoreHorizontal size={20} color={theme.colors.text} />} onPress={() => actions.open({ uuid: routeId, title: detail.data?.title ?? '' })} />
                ) : null}
                <IconButton label={tr('ai.assistant.new_chat')} icon={<SquarePen size={20} color={theme.colors.text} />} onPress={() => router.setParams({ id: NEW, prompt: '', n: String(Date.now()) })} />
              </>
            ) : undefined
          }
        />
        <AssistantGate access={access}>{(status) => <Chat key={initial.nonce} conversation={initial.uuid} prompt={initial.prompt} status={status} onConversationCreated={onCreated} />}</AssistantGate>
      </SafeAreaView>
      {actions.sheet}
    </KeyboardAvoider>
  );
}

function Chat({ conversation, prompt, status, onConversationCreated }: { conversation: string | null; prompt: string; status: AIStatus | null; onConversationCreated: (uuid: string) => void }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [convUuid, setConvUuid] = useState(conversation);
  const chat = useAssistantChat({
    conversationUuid: convUuid,
    onConversationCreated: (uuid) => {
      setConvUuid(uuid);
      onConversationCreated(uuid);
    },
  });
  const actions = useMemo(() => ({ confirm: chat.confirmAction, cancel: chat.cancelAction, busy: chat.busy }), [chat.confirmAction, chat.cancelAction, chat.busy]);
  const quota = status?.quota;
  const showQuota = quota && !quota.unlimited && quota.limit > 0;

  // A suggestion picked on the list starts the chat at once.
  const sent = useRef(false);
  const send = chat.send;
  useEffect(() => {
    if (sent.current || !prompt.trim() || conversation) return;
    sent.current = true;
    void send(prompt);
  }, [conversation, prompt, send]);

  return (
    <ChatActionsProvider value={actions}>
      {chat.loadError ? (
        <ErrorState error={chat.error} description={tr('ai.assistant.load_failed')} onRetry={() => void chat.refetch()} />
      ) : chat.loading && convUuid ? (
        <View style={{ flex: 1, padding: t.spacing.lg }}>
          <ListSkeleton rows={3} height={56} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={chat.messages}
          keyExtractor={(m) => m.uuid}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, flexGrow: 1 }}
          ListEmptyComponent={<ChatEmpty onPick={(text) => void chat.send(text)} disabled={chat.busy} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // While an answer streams the content grows many times a second: jump instead of starting
          // a new scroll animation per update.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: !chat.busy })}
        />
      )}
      <View
        style={{
          paddingHorizontal: t.spacing.lg,
          paddingTop: t.spacing.sm,
          paddingBottom: keyboard ? t.spacing.sm : Math.max(insets.bottom, t.spacing.sm),
          borderTopWidth: 1,
          borderTopColor: t.colors.border,
          backgroundColor: t.colors.background,
          gap: 6,
        }}
      >
        <Composer keyboardSpacer={false} onSend={(text) => void chat.send(text)} onStop={chat.stop} busy={chat.busy} />
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
    </ChatActionsProvider>
  );
}
