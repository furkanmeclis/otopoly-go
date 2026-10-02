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

export type AIConversationPage = {
  items: AIConversation[];
  total: number;
  limit: number;
  offset: number;
};

/** A chat message as rendered by the UI (server messages + the live one). */
export type ChatMessage = {
  uuid: string;
  role: AIMessage['role'];
  status: AIMessage['status'];
  blocks: AIUIBlock[];
  /** Waiting for the first event of the answer ("thinking…"). */
  pending?: boolean;
  /** Events are still arriving (tokens render as they stream in). */
  streaming?: boolean;
};
