import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type AIStatus = Schemas['AIStatus'];
export type AIQuota = Schemas['AIQuota'];
export type AIConversation = Schemas['AIConversation'];
export type AIConversationDetail = Schemas['AIConversationDetail'];
export type AIMessage = Schemas['AIMessage'];
export type AIUIBlock = Schemas['AIUIBlock'];
export type AIChart = Schemas['AIChart'];

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
