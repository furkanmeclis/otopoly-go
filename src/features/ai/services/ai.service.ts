import { request, requestStream } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { SseEvent } from '@/api/sse';
import { applyEvent, asAIEvent, streamingMessage, type AIStreamEvent } from '@/features/ai/lib/stream';
import type { AIConversation, AIConversationDetail, AIConversationPage, AIStatus, AIUIBlock, ChatMessage } from '@/features/ai/types';

export type StreamCallbacks = { onEvent: (event: AIStreamEvent) => void; signal?: AbortSignal };
export type AITurn = { events: AIStreamEvent[]; message: ChatMessage; userMessageUuid?: string; title?: string };
export type AIActionTurn = { events: AIStreamEvent[]; block: AIUIBlock; message?: ChatMessage };

function dispatch(ev: SseEvent, onEvent: (event: AIStreamEvent) => void) {
  const known = asAIEvent(ev);
  if (known) onEvent(known);
}

/** Tenant assistant endpoints (same paths as the web `aiTenantService` / `ai-stream.ts`). */
export const aiService = {
  status() {
    return request<AIStatus>('GET', '/v1/tenant/ai/status', { silent: true });
  },
  listConversations(query: { q?: string; limit?: number } = {}) {
    return request<AIConversationPage>('GET', '/v1/tenant/ai/conversations', {
      query: { ...(query.q ? { q: query.q } : {}), limit: query.limit ?? 50 },
      silent: true,
    });
  },
  createConversation(title?: string) {
    return request<AIConversation>('POST', '/v1/tenant/ai/conversations', { body: title ? { title } : {}, silent: true });
  },
  getConversation(uuid: string) {
    return request<AIConversationDetail>('GET', `/v1/tenant/ai/conversations/${uuid}`, { silent: true });
  },
  renameConversation(uuid: string, title: string) {
    return request<AIConversation>('PATCH', `/v1/tenant/ai/conversations/${uuid}`, { body: { title } });
  },
  deleteConversation(uuid: string) {
    return request<{ deleted: boolean }>('DELETE', `/v1/tenant/ai/conversations/${uuid}`);
  },
  /**
   * Sends one message and streams the answer (SSE, `Accept: text/event-stream`): `message_start`,
   * `text_delta`, `tool_start`/`tool_result`, `chart`, `plan`, `confirm`, `error`, `message_done`, `title`.
   * Mock and live share this reader; failures before the stream opens reject like `request`.
   */
  streamMessage(conversationUuid: string, content: string, locale: string, opts: StreamCallbacks) {
    return requestStream('POST', `/v1/tenant/ai/conversations/${conversationUuid}/messages`, {
      body: { content, locale },
      silent: true,
      signal: opts.signal,
      onEvent: (ev) => dispatch(ev, opts.onEvent),
    });
  },
  /**
   * Runs an action the assistant proposed (confirm card), optionally with edited fields, and streams the
   * `action` result followed by the assistant's continuation (`message_start` with `resumed: true`, …).
   */
  streamConfirm(actionUuid: string, edits: Record<string, string> | undefined, locale: string, opts: StreamCallbacks) {
    return requestStream('POST', `/v1/tenant/ai/actions/${actionUuid}/confirm`, {
      body: { ...(edits && Object.keys(edits).length ? { edits } : {}), locale },
      silent: true,
      signal: opts.signal,
      onEvent: (ev) => dispatch(ev, opts.onEvent),
    });
  },
  /** `streamMessage` collected into the finished turn (tests, non-UI callers). */
  async sendMessage(conversationUuid: string, content: string, locale: string): Promise<AITurn> {
    const events: AIStreamEvent[] = [];
    let message = streamingMessage('pending');
    let userMessageUuid: string | undefined;
    let title: string | undefined;
    await aiService.streamMessage(conversationUuid, content, locale, {
      onEvent: (ev) => {
        events.push(ev);
        if (ev.event === 'message_start') userMessageUuid = ev.data.user_message_uuid;
        else if (ev.event === 'title') title = ev.data.title;
        else message = applyEvent(message, ev);
      },
    });
    return { events, message, userMessageUuid, title };
  },
  /** `streamConfirm` collected into the updated card and the follow-up message (tests, non-UI callers). */
  async confirmAction(actionUuid: string, edits: Record<string, string> | undefined, locale: string): Promise<AIActionTurn> {
    const events: AIStreamEvent[] = [];
    let block: AIUIBlock | undefined;
    let message: ChatMessage | undefined;
    await aiService.streamConfirm(actionUuid, edits, locale, {
      onEvent: (ev) => {
        events.push(ev);
        if (ev.event === 'action') block = ev.data.block;
        else if (ev.event === 'message_start') message = streamingMessage('pending');
        else if (message && ev.event !== 'title') message = applyEvent(message, ev);
      },
    });
    if (!block) throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Stream ended without an action result' });
    return { events, block, message };
  },
  /** Cancels a pending action; nothing is executed. */
  cancelAction(actionUuid: string) {
    return request<{ block: AIUIBlock }>('POST', `/v1/tenant/ai/actions/${actionUuid}/cancel`, { silent: true });
  },
};
