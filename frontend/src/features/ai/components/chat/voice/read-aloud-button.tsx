"use client";

import { Loader2, Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVoice } from "@/features/ai/components/chat/voice/voice-provider";
import type { ChatMessage } from "@/features/ai/types";
import { useLocale } from "@/providers/locale-provider";

/** Plain text of an assistant message (text blocks only). */
export function messageSpeechText(message: ChatMessage) {
  return message.blocks
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

/** "Read aloud" toggle under a finished assistant message (voice on only). */
export function ReadAloudButton({ message }: { message: ChatMessage }) {
  const { t } = useLocale();
  const voice = useVoice();
  if (!voice || message.streaming) return null;
  const text = messageSpeechText(message);
  if (!text) return null;

  const active = voice.activeId === message.uuid;
  const label = active ? t("ai.voice.stop_reading") : t("ai.voice.read_aloud");
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      className="text-muted-foreground hover:text-foreground"
      onClick={() =>
        active ? voice.stopSpeaking() : voice.speak(message.uuid, text)
      }
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {active && voice.loading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : active ? (
        <Square className="size-3 fill-current" />
      ) : (
        <Volume2 className="size-3.5" />
      )}
    </Button>
  );
}
