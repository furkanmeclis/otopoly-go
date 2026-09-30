import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isApiError } from '@/api/errors';
import { aiService } from '@/features/ai/services/ai.service';
import type { AIConversationDetail, AIMessage, ChatMessage } from '@/features/ai/types';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';

const log = createLogger('ai.chat');

export const aiKeys = {
  status: [...qk.ai, 'status'] as const,
  conversations: [...qk.ai, 'conversations'] as const,
  list: (q: string) => [...qk.ai, 'conversations', 'list', q] as const,
  detail: (uuid: string) => [...qk.ai, 'conversations', 'detail', uuid] as const,
};

export function useAIStatus(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.status, queryFn: aiService.status, enabled, staleTime: 60_000, retry: false });
}

export function useConversationList(q: string, enabled = true) {
  return useQuery({ queryKey: aiKeys.list(q), queryFn: () => aiService.listConversations({ q }), enabled });
}

export function useConversationDetail(uuid: string | null) {
  return useQuery({
    queryKey: aiKeys.detail(uuid ?? ''),
    queryFn: () => aiService.getConversation(uuid ?? ''),
    enabled: Boolean(uuid),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRenameConversation() {
  const { t } = useLocale();
  return useApiMutation({
    key: 'ai.rename',
    fn: ({ uuid, title }: { uuid: string; title: string }) => aiService.renameConversation(uuid, title),
    invalidate: [aiKeys.conversations],
    success: t('mobile.settings.ai_renamed'),
    toastValidation: true,
  });
}

export function useDeleteConversation(onDeleted?: (uuid: string) => void) {
  const { t } = useLocale();
  return useApiMutation({
    key: 'ai.delete',
    fn: (uuid: string) => aiService.deleteConversation(uuid),
    invalidate: [aiKeys.conversations],
    success: t('ai.assistant.deleted'),
    onSuccess: (_d, uuid) => onDeleted?.(uuid),
  });
}

const toChat = (m: AIMessage): ChatMessage => ({ uuid: m.uuid, role: m.role, status: m.status, blocks: m.blocks });
const TYPE_STEP = 6;
const TYPE_TICK_MS = 24;

/**
 * Chat state for one conversation: server history + the live turn, with a short typing animation
 * for the newest assistant answer. Mirrors web `useAssistantChat` (send / stop / streaming / loadError).
 */
export function useAssistantChat({ conversationUuid, onConversationCreated }: { conversationUuid: string | null; onConversationCreated: (uuid: string) => void }) {
  const qc = useQueryClient();
  const { locale } = useLocale();
  const detail = useConversationDetail(conversationUuid);
  const [live, setLive] = useState<{ conv: string | null; messages: ChatMessage[] }>({ conv: null, messages: [] });
  const [typing, setTyping] = useState<{ uuid: string; shown: number; total: number } | null>(null);
  const turn = useRef(0);

  // Typing animation: reveal the newest answer a few characters per tick.
  useEffect(() => {
    if (!typing || typing.shown >= typing.total) return;
    const id = setInterval(() => {
      setTyping((cur) => (cur ? { ...cur, shown: Math.min(cur.total, cur.shown + TYPE_STEP) } : cur));
    }, TYPE_TICK_MS);
    return () => clearInterval(id);
  }, [typing]);

  const server = useMemo(() => (detail.data?.messages ?? []).map(toChat), [detail.data]);
  const liveMessages = useMemo(() => (live.conv === conversationUuid || live.conv === null ? live.messages : []), [live, conversationUuid]);
  const messages = useMemo(() => {
    const all = [...server, ...liveMessages];
    if (!typing || typing.shown >= typing.total) return all;
    return all.map((m) => (m.uuid === typing.uuid ? { ...m, blocks: truncateBlocks(m.blocks, typing.shown), typing: true } : m));
  }, [server, liveMessages, typing]);

  const pending = liveMessages.some((m) => m.pending);
  const animating = Boolean(typing && typing.shown < typing.total);

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || pending) return;
      const myTurn = ++turn.current;
      const userMsg: ChatMessage = { uuid: `local-user-${myTurn}`, role: 'user', status: 'complete', blocks: [{ type: 'text', text }] };
      const waiting: ChatMessage = { uuid: `local-assistant-${myTurn}`, role: 'assistant', status: 'pending', blocks: [], pending: true };
      setTyping(null);
      setLive({ conv: conversationUuid, messages: [userMsg, waiting] });
      let uuid = conversationUuid;
      try {
        if (!uuid) {
          const conv = await aiService.createConversation();
          uuid = conv.uuid;
          qc.setQueryData<AIConversationDetail>(aiKeys.detail(uuid), { ...conv, messages: [] });
          setLive({ conv: uuid, messages: [userMsg, waiting] });
          onConversationCreated(uuid);
        }
        const res = await aiService.sendMessage(uuid, text, locale);
        if (turn.current !== myTurn) return; // stopped by the user
        await qc.cancelQueries({ queryKey: aiKeys.detail(uuid) });
        qc.setQueryData<AIConversationDetail>(aiKeys.detail(uuid), (old) => ({
          ...(old ?? { ...res.conversation, messages: [] }),
          ...res.conversation,
          messages: [...(old?.messages ?? []), res.user_message, res.message],
        }));
        setLive({ conv: uuid, messages: [] });
        setTyping({ uuid: res.message.uuid, shown: 0, total: textLength(res.message.blocks) });
        void qc.invalidateQueries({ queryKey: aiKeys.conversations });
        void qc.invalidateQueries({ queryKey: aiKeys.status });
        log.info('Assistant answered', { conversation: uuid, blocks: res.message.blocks.length });
      } catch (error) {
        if (turn.current !== myTurn) return;
        log.warn('Assistant message failed', error);
        const code = isApiError(error) ? error.code : 'network';
        setLive({ conv: uuid, messages: [userMsg, { uuid: `local-error-${myTurn}`, role: 'assistant', status: 'error', blocks: [{ type: 'error', code }] }] });
      }
    },
    [conversationUuid, locale, onConversationCreated, pending, qc],
  );

  /** Stops the current turn: discards a pending answer, or finishes the typing animation at once. */
  const stop = useCallback(() => {
    if (pending) {
      turn.current += 1;
      setLive((cur) => ({ ...cur, messages: cur.messages.map((m) => (m.pending ? { ...m, pending: false, status: 'cancelled' } : m)) }));
      log.info('Assistant turn stopped');
      return;
    }
    setTyping((cur) => (cur ? { ...cur, shown: cur.total } : cur));
  }, [pending]);

  const reset = useCallback(() => {
    turn.current += 1;
    setLive({ conv: null, messages: [] });
    setTyping(null);
  }, []);

  return {
    messages,
    send,
    stop,
    reset,
    busy: pending || animating,
    loading: detail.isLoading,
    loadError: detail.isError,
    refetch: detail.refetch,
  };
}

function textLength(blocks: ChatMessage['blocks']) {
  return blocks.reduce((n, b) => n + (b.type === 'text' ? (b.text?.length ?? 0) : 0), 0);
}

/** Text blocks cut at `shown` characters; charts appear once their preceding text finished typing. */
function truncateBlocks(blocks: ChatMessage['blocks'], shown: number): ChatMessage['blocks'] {
  let left = shown;
  const out: ChatMessage['blocks'] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      const len = b.text?.length ?? 0;
      if (left <= 0) break;
      out.push({ ...b, text: (b.text ?? '').slice(0, left) });
      left -= len;
    } else if (b.type === 'tool') out.push(b);
    else if (left > 0 || out.some((x) => x.type === 'text')) out.push(b);
  }
  return out;
}
