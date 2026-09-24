"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { aiKeys } from "@/features/ai/hooks/query-keys";
import { useConversationDetail } from "@/features/ai/hooks/use-conversations";
import { aiTenantService } from "@/features/ai/services/ai.service";
import {
  streamAssistantMessage,
  streamConfirmAction,
} from "@/features/ai/services/ai-stream";
import type {
  AIConversationDetail,
  AIStreamEvent,
  AIUIBlock,
  ChatMessage,
} from "@/features/ai/types";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

type Options = {
  slug: string;
  conversationUuid: string | null;
  /** Called when sending from an empty chat created a conversation. */
  onConversationCreated?: (uuid: string) => void;
};

let tempCounter = 0;
function tempId(prefix: string) {
  tempCounter += 1;
  return `${prefix}-${Date.now()}-${tempCounter}`;
}

/** Applies one server-sent event to the streaming assistant message. */
function applyEvent(message: ChatMessage, ev: AIStreamEvent): ChatMessage {
  const blocks = [...message.blocks];
  switch (ev.event) {
    case "text_delta": {
      const last = blocks[blocks.length - 1];
      if (last?.type === "text") {
        blocks[blocks.length - 1] = {
          ...last,
          text: (last.text ?? "") + ev.data.text,
        };
      } else {
        blocks.push({ type: "text", text: ev.data.text });
      }
      return { ...message, blocks };
    }
    case "tool_start":
      if (blocks.some((b) => b.type === "tool" && b.id === ev.data.id)) {
        return message;
      }
      blocks.push({
        type: "tool",
        id: ev.data.id,
        name: ev.data.name,
        status: "running",
      });
      return { ...message, blocks };
    case "tool_result":
      return {
        ...message,
        blocks: blocks.map((b) =>
          b.type === "tool" && b.id === ev.data.id
            ? {
                ...b,
                status: ev.data.ok ? "done" : "error",
                summary_key: ev.data.summary_key,
                summary_params: ev.data.summary_params,
              }
            : b,
        ),
      };
    case "chart":
      blocks.push({ type: "chart", id: ev.data.id, chart: ev.data.chart });
      return { ...message, blocks };
    case "confirm": {
      const card = ev.data.block;
      const toolUseId = (card.data as { tool_use_id?: string } | undefined)
        ?.tool_use_id;
      const next = blocks.map((b) =>
        b.type === "tool" && b.id === toolUseId
          ? { ...b, status: "pending" }
          : b,
      );
      next.push(card);
      return { ...message, blocks: next };
    }
    case "plan": {
      const idx = blocks.findIndex((b) => b.type === "todo_list");
      if (idx >= 0) blocks[idx] = ev.data.block;
      else blocks.push(ev.data.block);
      return { ...message, blocks };
    }
    case "error":
      blocks.push({
        type: "error",
        code: ev.data.code,
        message: ev.data.message,
      });
      return { ...message, blocks };
    case "message_done":
      return {
        ...message,
        uuid: ev.data.message_uuid,
        status: ev.data.status,
        streaming: false,
      };
    default:
      return message;
  }
}

/** Replaces a confirm card (and its tool indicator) wherever it is. */
function replaceCard(
  messages: ChatMessage[],
  card: AIUIBlock,
  toolStatus?: string,
): ChatMessage[] {
  const toolUseId = (card.data as { tool_use_id?: string } | undefined)
    ?.tool_use_id;
  return messages.map((m) =>
    m.blocks.some((b) => b.type === "confirm" && b.id === card.id)
      ? {
          ...m,
          blocks: m.blocks.map((b) => {
            if (b.type === "confirm" && b.id === card.id) return card;
            if (toolStatus && b.type === "tool" && b.id === toolUseId) {
              return { ...b, status: toolStatus };
            }
            return b;
          }),
        }
      : m,
  );
}

function toolStatusFor(status?: string) {
  if (status === "confirmed") return "done";
  if (status === "failed") return "error";
  if (status === "cancelled" || status === "expired") return "cancelled";
  return undefined;
}

function toChatMessages(detail?: AIConversationDetail): ChatMessage[] {
  return (detail?.messages ?? []).map((m) => ({
    uuid: m.uuid,
    role: m.role,
    status: m.status,
    blocks: m.blocks,
  }));
}

export function useAssistantChat({
  slug,
  conversationUuid,
  onConversationCreated,
}: Options) {
  const { locale } = useLocale();
  const qc = useQueryClient();
  const detail = useConversationDetail(slug, conversationUuid);
  // Messages touched in this session, keyed by conversation uuid. Server data
  // is used for conversations we have not streamed into yet.
  const [live, setLive] = useState<Record<string, ChatMessage[]>>({});
  const [streamingFor, setStreamingFor] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const messages: ChatMessage[] = useMemo(
    () =>
      conversationUuid
        ? (live[conversationUuid] ?? toChatMessages(detail.data))
        : [],
    [conversationUuid, detail.data, live],
  );

  const updateAssistant = useCallback(
    (
      convUuid: string,
      assistantId: string,
      fn: (m: ChatMessage) => ChatMessage,
    ) => {
      setLive((prev) => ({
        ...prev,
        [convUuid]: (prev[convUuid] ?? []).map((m) =>
          m.uuid === assistantId ? fn(m) : m,
        ),
      }));
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streamingFor) return;

      let convUuid = conversationUuid;
      let base: ChatMessage[] = messages;
      if (!convUuid) {
        try {
          const conv = await aiTenantService.createConversation();
          convUuid = conv.uuid;
          base = [];
          qc.setQueryData(aiKeys.conversation(slug, conv.uuid), {
            ...conv,
            messages: [],
          });
          onConversationCreated?.(conv.uuid);
        } catch {
          return;
        }
      }
      const uuid = convUuid;
      const assistantId = tempId("assistant");
      const userMessage: ChatMessage = {
        uuid: tempId("user"),
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: content }],
      };
      const assistantMessage: ChatMessage = {
        uuid: assistantId,
        role: "assistant",
        status: "pending",
        blocks: [],
        streaming: true,
      };
      setLive((prev) => ({
        ...prev,
        [uuid]: [...(prev[uuid] ?? base), userMessage, assistantMessage],
      }));
      setStreamingFor(uuid);

      const controller = new AbortController();
      abortRef.current = controller;
      let currentId = assistantId;
      try {
        await streamAssistantMessage({
          conversationUuid: uuid,
          content,
          locale,
          tenantSlug: slug,
          signal: controller.signal,
          onEvent: (ev) => {
            if (ev.event === "title") {
              void qc.invalidateQueries({
                queryKey: aiKeys.conversations(slug),
              });
              return;
            }
            const id = currentId;
            if (ev.event === "message_done") currentId = ev.data.message_uuid;
            updateAssistant(uuid, id, (m) => applyEvent(m, ev));
          },
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        const code = isApiError(error) ? error.code : "network";
        updateAssistant(uuid, currentId, (m) => ({
          ...m,
          streaming: false,
          status: aborted ? "cancelled" : "error",
          blocks: aborted
            ? m.blocks
            : [...m.blocks, { type: "error", code } satisfies AIUIBlock],
        }));
        if (isApiError(error) && error.code.startsWith("AI_")) {
          void qc.invalidateQueries({ queryKey: aiKeys.status(slug) });
        }
      } finally {
        updateAssistant(uuid, currentId, (m) =>
          m.streaming
            ? {
                ...m,
                streaming: false,
                status: controller.signal.aborted ? "cancelled" : m.status,
              }
            : m,
        );
        abortRef.current = null;
        setStreamingFor(null);
        void qc.invalidateQueries({ queryKey: aiKeys.conversations(slug) });
        void qc.invalidateQueries({ queryKey: aiKeys.status(slug) });
      }
    },
    [
      conversationUuid,
      locale,
      messages,
      onConversationCreated,
      qc,
      slug,
      streamingFor,
      updateAssistant,
    ],
  );

  /** Updates a confirm card locally (optimistic "executing" state, results). */
  const setCard = useCallback(
    (convUuid: string, card: AIUIBlock) => {
      setLive((prev) => ({
        ...prev,
        [convUuid]: replaceCard(
          prev[convUuid] ?? messages,
          card,
          toolStatusFor(card.status),
        ),
      }));
    },
    [messages],
  );

  const confirmAction = useCallback(
    async (card: AIUIBlock, edits?: Record<string, string>) => {
      const uuid = conversationUuid;
      if (!uuid || !card.id || streamingFor) return;
      setCard(uuid, { ...card, status: "executing" });
      setStreamingFor(uuid);
      const controller = new AbortController();
      abortRef.current = controller;
      let currentId: string | null = null;
      try {
        await streamConfirmAction({
          actionUuid: card.id,
          edits,
          locale,
          tenantSlug: slug,
          signal: controller.signal,
          onEvent: (ev) => {
            if (ev.event === "action") {
              setCard(uuid, ev.data.block);
              return;
            }
            if (ev.event === "message_start") {
              const id = tempId("assistant");
              currentId = id;
              setLive((prev) => ({
                ...prev,
                [uuid]: [
                  ...(prev[uuid] ?? messages),
                  {
                    uuid: id,
                    role: "assistant",
                    status: "pending",
                    blocks: [],
                    streaming: true,
                  },
                ],
              }));
              return;
            }
            if (ev.event === "title" || !currentId) return;
            const id = currentId;
            if (ev.event === "message_done") currentId = ev.data.message_uuid;
            updateAssistant(uuid, id, (m) => applyEvent(m, ev));
          },
        });
      } catch (error) {
        // The action was not executed (or its state is unknown): reload the
        // conversation so the card shows the server's status.
        void qc.invalidateQueries({
          queryKey: aiKeys.conversation(slug, uuid),
        });
        setLive((prev) => {
          const next = { ...prev };
          delete next[uuid];
          return next;
        });
        throw error;
      } finally {
        if (currentId) {
          const id = currentId;
          updateAssistant(uuid, id, (m) =>
            m.streaming ? { ...m, streaming: false } : m,
          );
        }
        abortRef.current = null;
        setStreamingFor(null);
        void qc.invalidateQueries({ queryKey: aiKeys.status(slug) });
      }
    },
    [
      conversationUuid,
      locale,
      messages,
      qc,
      setCard,
      slug,
      streamingFor,
      updateAssistant,
    ],
  );

  const cancelAction = useCallback(
    async (card: AIUIBlock) => {
      const uuid = conversationUuid;
      if (!uuid || !card.id) return;
      try {
        const res = await aiTenantService.cancelAction(card.id);
        setCard(uuid, res.block);
      } catch (error) {
        void qc.invalidateQueries({
          queryKey: aiKeys.conversation(slug, uuid),
        });
        setLive((prev) => {
          const next = { ...prev };
          delete next[uuid];
          return next;
        });
        throw error;
      }
    },
    [conversationUuid, qc, setCard, slug],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    send,
    stop,
    confirmAction,
    cancelAction,
    streaming: streamingFor !== null,
    loading:
      Boolean(conversationUuid) &&
      detail.isLoading &&
      !live[conversationUuid ?? ""],
    loadError: detail.isError,
  };
}
