import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isAborted } from '@/api/client';
import { isApiError } from '@/api/errors';
import { replaceCard } from '@/features/ai/lib/blocks';
import { applyEvent, streamingMessage, toServerMessage, type AIStreamEvent } from '@/features/ai/lib/stream';
import { aiService } from '@/features/ai/services/ai.service';
import type { AIConversationDetail, AIMessage, AIUIBlock, ChatMessage } from '@/features/ai/types';
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

/** A stream that stopped before `message_done`: keep what arrived and say why. */
function interrupted(m: ChatMessage, error: unknown): ChatMessage {
  if (isAborted(error)) return { ...m, pending: false, streaming: false, status: 'cancelled' };
  const code = isApiError(error) ? error.code : 'network';
  const hasError = m.blocks.some((b) => b.type === 'error');
  return { ...m, pending: false, streaming: false, status: 'error', blocks: hasError ? m.blocks : [...m.blocks, { type: 'error', code }] };
}

/**
 * Chat state for one conversation: server history + the turn being streamed. Mirrors web
 * `useAssistantChat`: tokens render as `text_delta` events arrive, tool chips / charts / plan / confirm
 * cards appear as their events do, `stop` aborts the stream, and leaving the screen aborts it too.
 */
export function useAssistantChat({ conversationUuid, onConversationCreated }: { conversationUuid: string | null; onConversationCreated: (uuid: string) => void }) {
  const qc = useQueryClient();
  const { locale } = useLocale();
  const detail = useConversationDetail(conversationUuid);
  const [live, setLive] = useState<{ conv: string | null; messages: ChatMessage[] }>({ conv: null, messages: [] });
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turn = useRef(0);
  const mounted = useRef(true);

  // Leaving the chat (unmount, other conversation) closes any open stream.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const server = useMemo(() => (detail.data?.messages ?? []).map(toChat), [detail.data]);
  const liveMessages = useMemo(() => (live.conv === conversationUuid || live.conv === null ? live.messages : []), [live, conversationUuid]);
  const messages = useMemo(() => [...server, ...liveMessages], [server, liveMessages]);

  /** Appends finished messages to the cached conversation (no refetch needed). */
  const commit = useCallback(
    (uuid: string, append: AIMessage[], title?: string) => {
      // Not loaded yet (opened mid-load): the server copy already has the turn.
      if (!qc.getQueryData(aiKeys.detail(uuid))) {
        void qc.invalidateQueries({ queryKey: aiKeys.detail(uuid) });
        return;
      }
      qc.setQueryData<AIConversationDetail>(aiKeys.detail(uuid), (old) =>
        old ? { ...old, ...(title ? { title } : {}), message_count: old.message_count + append.length, messages: [...old.messages, ...append] } : old,
      );
    },
    [qc],
  );

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || abortRef.current) return;
      const myTurn = ++turn.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const userMsg: ChatMessage = { uuid: `local-user-${myTurn}`, role: 'user', status: 'complete', blocks: [{ type: 'text', text }] };
      let msg = streamingMessage(`local-assistant-${myTurn}`);
      let userUuid = userMsg.uuid;
      let done = false;
      let uuid = conversationUuid;
      const show = () => {
        if (mounted.current && turn.current === myTurn) setLive({ conv: uuid, messages: done ? [] : [userMsg, msg] });
      };
      setStreaming(true);
      show();
      try {
        if (!uuid) {
          const conv = await aiService.createConversation();
          uuid = conv.uuid;
          qc.setQueryData<AIConversationDetail>(aiKeys.detail(uuid), { ...conv, messages: [] });
          show();
          onConversationCreated(uuid);
        }
        const convUuid = uuid;
        await aiService.streamMessage(convUuid, text, locale, {
          signal: controller.signal,
          onEvent: (ev: AIStreamEvent) => {
            if (ev.event === 'message_start') {
              if (ev.data.user_message_uuid) userUuid = ev.data.user_message_uuid;
              return;
            }
            if (ev.event === 'title') {
              commit(convUuid, [], ev.data.title);
              void qc.invalidateQueries({ queryKey: aiKeys.conversations });
              return;
            }
            msg = applyEvent(msg, ev);
            if (ev.event === 'message_done') {
              done = true;
              commit(convUuid, [toServerMessage({ ...userMsg, uuid: userUuid }), toServerMessage(msg)]);
              log.info('Assistant answered', { conversation: convUuid, blocks: msg.blocks.length, status: msg.status });
            }
            show();
          },
        });
        if (!done) {
          msg = interrupted(msg, null);
          show();
        }
      } catch (error) {
        if (isAborted(error)) log.info('Assistant turn stopped');
        else log.warn('Assistant message failed', error);
        if (!done) {
          msg = interrupted(msg, error);
          show();
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (mounted.current) setStreaming(false);
        void qc.invalidateQueries({ queryKey: aiKeys.conversations });
        void qc.invalidateQueries({ queryKey: aiKeys.status });
      }
    },
    [commit, conversationUuid, locale, onConversationCreated, qc],
  );

  /** Stops the current stream; what already arrived stays on screen, marked as stopped. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Puts a confirm card (and its tool chip) in its new state in the cached conversation. */
  const setCard = useCallback(
    (uuid: string, card: AIUIBlock) => {
      qc.setQueryData<AIConversationDetail>(aiKeys.detail(uuid), (old) => (old ? { ...old, messages: replaceCard(old.messages, card) } : old));
    },
    [qc],
  );

  /**
   * Runs an action the assistant proposed (web `confirmAction`), with optional edited fields: streams the
   * `action` result into the card, then the assistant's follow-up message token by token.
   */
  const confirmAction = useCallback(
    async (card: AIUIBlock, edits?: Record<string, string>) => {
      const uuid = conversationUuid;
      if (!uuid || !card.id || abortRef.current) return;
      const myTurn = ++turn.current;
      const controller = new AbortController();
      abortRef.current = controller;
      let msg: ChatMessage | null = null;
      let resolved = false;
      let done = false;
      const show = () => {
        if (mounted.current && turn.current === myTurn) setLive({ conv: uuid, messages: msg && !done ? [msg] : [] });
      };
      setCard(uuid, { ...card, status: 'executing' });
      setStreaming(true);
      setLive({ conv: uuid, messages: [] });
      try {
        await aiService.streamConfirm(card.id, edits, locale, {
          signal: controller.signal,
          onEvent: (ev: AIStreamEvent) => {
            if (ev.event === 'action') {
              resolved = true;
              setCard(uuid, ev.data.block);
              log.info('Assistant action confirmed', { action: card.id, status: ev.data.status });
              return;
            }
            if (ev.event === 'message_start') {
              msg = streamingMessage(`local-assistant-${myTurn}`);
              show();
              return;
            }
            if (!msg || ev.event === 'title') return;
            msg = applyEvent(msg, ev);
            if (ev.event === 'message_done') {
              done = true;
              commit(uuid, [toServerMessage(msg)]);
            }
            show();
          },
        });
        if (!resolved) throw new Error('stream ended without an action result');
        // The plan checklist of the proposing message moves on too: take the server's copy.
        if (done || !msg) void qc.invalidateQueries({ queryKey: aiKeys.detail(uuid) });
        else {
          msg = interrupted(msg, null);
          show();
        }
      } catch (error) {
        if (!resolved) {
          // Not executed (or unknown): reload so the card shows the server's status.
          setLive({ conv: uuid, messages: [] });
          void qc.invalidateQueries({ queryKey: aiKeys.detail(uuid) });
          if (!isAborted(error)) throw error;
        } else if (msg && !done) {
          msg = interrupted(msg, error);
          show();
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (mounted.current) setStreaming(false);
        void qc.invalidateQueries({ queryKey: aiKeys.status });
      }
    },
    [commit, conversationUuid, locale, qc, setCard],
  );

  const cancelAction = useCallback(
    async (card: AIUIBlock) => {
      const uuid = conversationUuid;
      if (!uuid || !card.id) return;
      try {
        const res = await aiService.cancelAction(card.id);
        setCard(uuid, res.block);
        log.info('Assistant action cancelled', { action: card.id });
      } catch (error) {
        void qc.invalidateQueries({ queryKey: aiKeys.detail(uuid) });
        throw error;
      }
    },
    [conversationUuid, qc, setCard],
  );

  const reset = useCallback(() => {
    turn.current += 1;
    abortRef.current?.abort();
    setLive({ conv: null, messages: [] });
  }, []);

  return {
    messages,
    send,
    stop,
    reset,
    confirmAction,
    cancelAction,
    busy: streaming,
    loading: detail.isLoading,
    loadError: detail.isError,
    refetch: detail.refetch,
  };
}
