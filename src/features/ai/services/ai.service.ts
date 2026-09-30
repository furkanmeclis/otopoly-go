import { request } from '@/api/client';
import type { AIConversation, AIConversationDetail, AIConversationPage, AISendResult, AIStatus } from '@/features/ai/types';

/** Tenant assistant endpoints (same paths as the web `aiTenantService`). */
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
   * Sends one message. The live Go API answers with SSE (`text/event-stream`); the mock returns the
   * finished turn as JSON. See docs/port-reports/settings.md — SSE parsing is still to be wired for live mode.
   */
  sendMessage(conversationUuid: string, content: string, locale: string) {
    return request<AISendResult>('POST', `/v1/tenant/ai/conversations/${conversationUuid}/messages`, {
      body: { content, locale },
      silent: true,
    });
  },
};
