/**
 * AI server-sent events (Go `aiusecase.Event*`, openapi `sendTenantAIMessage` / `confirmTenantAIAction`)
 * and the reducer that builds the streaming assistant message from them — same rules as the web
 * `applyEvent` in `use-assistant-chat.ts`. Pure (no React Native imports) so the smoke tests use it.
 */
import type { SseEvent } from '@/api/sse';
import type { AIActionStatus, AIChart, AIMessage, AIUIBlock, ChatMessage } from '@/features/ai/types';

export type AIStreamEvent =
  | { event: 'message_start'; data: { conversation_uuid: string; user_message_uuid?: string; resumed?: boolean; action_uuid?: string } }
  | { event: 'text_delta'; data: { text: string } }
  | { event: 'tool_start'; data: { id: string; name: string } }
  | { event: 'tool_result'; data: { id: string; name: string; ok: boolean; summary_key?: string; summary_params?: Record<string, string | number> } }
  | { event: 'chart'; data: { id: string; chart: AIChart } }
  | { event: 'plan'; data: { block: AIUIBlock } }
  | { event: 'confirm'; data: { block: AIUIBlock } }
  | { event: 'error'; data: { code: string; message: string } }
  | { event: 'message_done'; data: { message_uuid: string; status: AIMessage['status']; stop_reason: string; usage: Record<string, number> } }
  | { event: 'title'; data: { conversation_uuid: string; title: string } }
  | { event: 'action'; data: { action_uuid: string; status: AIActionStatus; tool_use_id: string; block: AIUIBlock } };

export const AI_STREAM_EVENTS = ['message_start', 'text_delta', 'tool_start', 'tool_result', 'chart', 'plan', 'confirm', 'error', 'message_done', 'title', 'action'] as const;

/** Narrows a raw SSE event to a known AI event (unknown events are skipped, like the web client). */
export function asAIEvent(ev: SseEvent): AIStreamEvent | null {
  if (!(AI_STREAM_EVENTS as readonly string[]).includes(ev.event) || !ev.data || typeof ev.data !== 'object') return null;
  return ev as AIStreamEvent;
}

/** An empty assistant message waiting for its first event ("thinking…"). */
export function streamingMessage(uuid: string): ChatMessage {
  return { uuid, role: 'assistant', status: 'pending', blocks: [], pending: true, streaming: true };
}

/** Applies one event to the streaming assistant message. */
export function applyEvent(message: ChatMessage, ev: AIStreamEvent): ChatMessage {
  const blocks = [...message.blocks];
  const next = (b: AIUIBlock[]): ChatMessage => ({ ...message, blocks: b, pending: false });
  switch (ev.event) {
    case 'text_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text') blocks[blocks.length - 1] = { ...last, text: (last.text ?? '') + ev.data.text };
      else blocks.push({ type: 'text', text: ev.data.text });
      return next(blocks);
    }
    case 'tool_start':
      if (blocks.some((b) => b.type === 'tool' && b.id === ev.data.id)) return message;
      blocks.push({ type: 'tool', id: ev.data.id, name: ev.data.name, status: 'running' });
      return next(blocks);
    case 'tool_result':
      return next(
        blocks.map((b) =>
          b.type === 'tool' && b.id === ev.data.id ? { ...b, status: ev.data.ok ? 'done' : 'error', summary_key: ev.data.summary_key, summary_params: ev.data.summary_params } : b,
        ),
      );
    case 'chart':
      blocks.push({ type: 'chart', id: ev.data.id, chart: ev.data.chart });
      return next(blocks);
    case 'confirm': {
      const card = ev.data.block;
      const toolUseId = (card.data as { tool_use_id?: string } | undefined)?.tool_use_id;
      const out = blocks.map((b) => (b.type === 'tool' && b.id === toolUseId ? { ...b, status: 'pending' } : b));
      out.push(card);
      return next(out);
    }
    case 'plan': {
      // The checklist is replaced in place (one per message).
      const idx = blocks.findIndex((b) => b.type === 'todo_list');
      if (idx >= 0) blocks[idx] = ev.data.block;
      else blocks.push(ev.data.block);
      return next(blocks);
    }
    case 'error':
      blocks.push({ type: 'error', code: ev.data.code, message: ev.data.message });
      return next(blocks);
    case 'message_done':
      return { ...message, uuid: ev.data.message_uuid, status: ev.data.status, pending: false, streaming: false };
    default:
      return message;
  }
}

/** The finished message as the server stores it (for the conversation cache). */
export function toServerMessage(m: ChatMessage, createdAt = new Date().toISOString()): AIMessage {
  return { uuid: m.uuid, role: m.role, status: m.status, blocks: m.blocks, created_at: createdAt };
}
