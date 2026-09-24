"use client";

import { useEffect, useRef } from "react";

import { messageSpeechText } from "@/features/ai/components/chat/voice/read-aloud-button";
import { useVoice } from "@/features/ai/components/chat/voice/voice-provider";
import type { ChatMessage } from "@/features/ai/types";

/**
 * Reads a reply aloud when it finishes streaming, if the viewer turned on
 * "read replies aloud". Renders nothing.
 */
export function VoiceAutoRead({
  messages,
  streaming,
}: {
  messages: ChatMessage[];
  streaming: boolean;
}) {
  const voice = useVoice();
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || !voice?.prefs.autoRead) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.status !== "complete")
      return;
    const text = messageSpeechText(last);
    if (text) voice.speak(last.uuid, text);
  }, [streaming, messages, voice]);

  return null;
}
