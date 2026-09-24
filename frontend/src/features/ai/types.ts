import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type AISettings = Schemas["AISettings"];
export type AISettingsPatch = Schemas["PatchAISettingsRequest"];
export type AIToolInfo = Schemas["AIToolInfo"];
export type AITestResult = Schemas["AITestResult"];
export type AIStatus = Schemas["AIStatus"];
export type AIQuota = Schemas["AIQuota"];
export type AIConversation = Schemas["AIConversation"];
export type AIConversationDetail = Schemas["AIConversationDetail"];
export type AIMessage = Schemas["AIMessage"];
export type AIUIBlock = Schemas["AIUIBlock"];
export type AIChart = Schemas["AIChart"];
export type AIOrgSettings = Schemas["AIOrgSettings"];
export type AIOrgSettingsPut = Schemas["PutAIOrgSettingsRequest"];
export type AIUsageSummary = Schemas["AIUsageSummary"];
export type AIUsageOrgRow = Schemas["AIUsageOrgRow"];
export type AIConfirmCard = Schemas["AIConfirmCard"];
export type AIActionPreview = Schemas["AIActionPreview"];
export type AIEditField = Schemas["AIEditField"];
export type AIActionResult = Schemas["AIActionResult"];
export type AIActionLink = Schemas["AIActionLink"];
export type AIPlan = Schemas["AIPlan"];

/** Confirm card status (the pending action's lifecycle). */
export type AIActionStatus =
  "pending" | "executing" | "confirmed" | "failed" | "cancelled" | "expired";

export type AIConversationPage = {
  items: AIConversation[];
  total: number;
  limit: number;
  offset: number;
};

/** Server-sent events emitted by POST /v1/tenant/ai/conversations/{uuid}/messages. */
export type AIStreamEvent =
  | {
      event: "message_start";
      data: {
        conversation_uuid: string;
        user_message_uuid?: string;
        /** Set when the stream continues after a confirmed action. */
        resumed?: boolean;
        action_uuid?: string;
      };
    }
  | { event: "confirm"; data: { block: AIUIBlock } }
  | { event: "plan"; data: { block: AIUIBlock } }
  | {
      event: "action";
      data: {
        action_uuid: string;
        status: AIActionStatus;
        tool_use_id: string;
        block: AIUIBlock;
      };
    }
  | { event: "text_delta"; data: { text: string } }
  | { event: "tool_start"; data: { id: string; name: string } }
  | {
      event: "tool_result";
      data: {
        id: string;
        name: string;
        ok: boolean;
        summary_key?: string;
        summary_params?: Record<string, string | number>;
      };
    }
  | { event: "chart"; data: { id: string; chart: AIChart } }
  | { event: "error"; data: { code: string; message: string } }
  | {
      event: "message_done";
      data: {
        message_uuid: string;
        status: AIMessage["status"];
        stop_reason: string;
        usage: Record<string, number>;
      };
    }
  | { event: "title"; data: { conversation_uuid: string; title: string } };

/** A chat message as rendered by the UI (server messages + the live one). */
export type ChatMessage = {
  uuid: string;
  role: AIMessage["role"];
  status: AIMessage["status"];
  blocks: AIUIBlock[];
  streaming?: boolean;
};
