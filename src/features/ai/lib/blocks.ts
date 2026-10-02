/** Pure chat-block helpers (no React Native imports, so the smoke tests can use them). */
import { toolStatusFor } from '@/features/ai/lib/labels';
import type { AIMessage, AIUIBlock } from '@/features/ai/types';

/** Replaces a confirm card (and its tool chip) wherever it is (web `replaceCard`). */
export function replaceCard(messages: AIMessage[], card: AIUIBlock): AIMessage[] {
  const toolUseId = (card.data as { tool_use_id?: string } | undefined)?.tool_use_id;
  const toolStatus = toolStatusFor(card.status);
  return messages.map((m) =>
    m.blocks.some((b) => b.type === 'confirm' && b.id === card.id)
      ? {
          ...m,
          blocks: m.blocks.map((b) => {
            if (b.type === 'confirm' && b.id === card.id) return card;
            if (toolStatus && b.type === 'tool' && b.id === toolUseId) return { ...b, status: toolStatus };
            return b;
          }),
        }
      : m,
  );
}
