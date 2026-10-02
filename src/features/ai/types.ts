import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type AIStatus = Schemas['AIStatus'];
export type AIQuota = Schemas['AIQuota'];
export type AIConversation = Schemas['AIConversation'];
export type AIConversationDetail = Schemas['AIConversationDetail'];
export type AIMessage = Schemas['AIMessage'];
export type AIUIBlock = Schemas['AIUIBlock'];
export type AIChart = Schemas['AIChart'];
export type AIConfirmCard = Schemas['AIConfirmCard'];
export type AIEditField = Schemas['AIEditField'];
export type AIActionLink = Schemas['AIActionLink'];
export type AIPlan = Schemas['AIPlan'];
export type AIPlanItem = Schemas['AIPlanItem'];
/** `confirm` block status (web `AIActionStatus`). */
export type AIActionStatus = 'pending' | 'executing' | 'confirmed' | 'failed' | 'cancelled' | 'expired';

/**
 * Result of confirming a proposed action. The live API streams it (SSE `action` event, then the
 * assistant's follow-up message); the mock returns both as JSON.
 */
export type AIActionResultPayload = {
  block: AIUIBlock;
  message?: AIMessage;
};

export type AIConversationPage = {
  items: AIConversation[];
  total: number;
  limit: number;
  offset: number;
};

/** Result of one chat turn (mock JSON transport; the live backend streams the same blocks via SSE). */
export type AISendResult = {
  conversation: AIConversation;
  user_message: AIMessage;
  message: AIMessage;
};

/** A chat message as rendered by the UI (server messages + the live one). */
export type ChatMessage = {
  uuid: string;
  role: AIMessage['role'];
  status: AIMessage['status'];
  blocks: AIUIBlock[];
  /** Waiting for the answer ("thinking…"). */
  pending?: boolean;
  /** Characters of text revealed so far while the typing animation runs. */
  typing?: boolean;
};
