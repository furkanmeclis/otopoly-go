import { apiConfig } from "@/config/api";
import { ApiError, parseApiError } from "@/lib/api";
import type { AIStreamEvent } from "@/features/ai/types";

type StreamOptions = {
  conversationUuid: string;
  content: string;
  locale: string;
  tenantSlug?: string;
  signal?: AbortSignal;
  onEvent: (event: AIStreamEvent) => void;
};

const FRAME_SEPARATOR = /\r?\n\r?\n/;

function messagesUrl(conversationUuid: string) {
  const base = apiConfig.baseUrl.replace(/\/$/, "");
  return `${base}/v1/tenant/ai/conversations/${encodeURIComponent(conversationUuid)}/messages`;
}

async function switchOrganization(slug: string) {
  const base = apiConfig.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/auth/organization-context`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ organization_slug: slug }),
  });
  return res.ok;
}

/** Parses one SSE frame ("event: x\ndata: {...}"); comments are ignored. */
function parseFrame(frame: string): AIStreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) } as AIStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Sends a chat message through the same-origin BFF and dispatches the
 * server-sent events as they arrive (fetch + ReadableStream, so POST works).
 */
export async function streamAssistantMessage({
  conversationUuid,
  content,
  locale,
  tenantSlug,
  signal,
  onEvent,
}: StreamOptions): Promise<void> {
  const send = () =>
    fetch(messagesUrl(conversationUuid), {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, locale }),
      signal,
    });

  let response = await send();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = parseApiError(response.status, body);
    if (error.code === "ORGANIZATION_CONTEXT_REQUIRED" && tenantSlug) {
      if (await switchOrganization(tenantSlug)) {
        response = await send();
      }
    } else {
      throw error;
    }
    if (!response.ok) {
      throw parseApiError(
        response.status,
        await response.json().catch(() => null),
      );
    }
  }
  if (!response.body) {
    throw new ApiError({
      status: 0,
      code: "NETWORK",
      message: "empty stream",
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (
      let match = FRAME_SEPARATOR.exec(buffer);
      match;
      match = FRAME_SEPARATOR.exec(buffer)
    ) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const parsed = parseFrame(frame);
      if (parsed) onEvent(parsed);
    }
  }
  const tail = parseFrame(buffer);
  if (tail) onEvent(tail);
}
