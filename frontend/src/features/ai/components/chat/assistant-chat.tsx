"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { ChatActionsProvider } from "@/features/ai/components/chat/chat-actions";
import { Composer } from "@/features/ai/components/chat/composer";
import { MessageList } from "@/features/ai/components/chat/message-list";
import { VoiceAutoRead } from "@/features/ai/components/chat/voice/voice-auto-read";
import { VoiceInput } from "@/features/ai/components/chat/voice/voice-input";
import {
  useVoice,
  VoiceProvider,
} from "@/features/ai/components/chat/voice/voice-provider";
import { useAssistantChat } from "@/features/ai/hooks/use-assistant-chat";
import type { AIStatus } from "@/features/ai/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const SUGGESTION_KEYS = [
  "ai.suggestions.delivered_today",
  "ai.suggestions.revenue_chart",
  "ai.suggestions.receivables",
  "ai.suggestions.cash",
  "ai.suggestions.low_stock",
] as const;

type AssistantChatProps = {
  slug: string;
  status: AIStatus | null;
  conversationUuid: string | null;
  onConversationChange: (uuid: string) => void;
  /** Extra controls inside the composer (the voice mic is added automatically). */
  composerActions?: ReactNode;
  className?: string;
};

export function AssistantChat(props: AssistantChatProps) {
  // Voice (push-to-talk + read-aloud) only when the platform enabled it.
  if (!props.status?.features.voice) return <AssistantChatInner {...props} />;
  return (
    <VoiceProvider>
      <AssistantChatInner {...props} />
    </VoiceProvider>
  );
}

function AssistantChatInner({
  slug,
  status,
  conversationUuid,
  onConversationChange,
  composerActions,
  className,
}: AssistantChatProps) {
  const { t, locale } = useLocale();
  const {
    messages,
    send,
    stop,
    streaming,
    loading,
    loadError,
    confirmAction,
    cancelAction,
  } = useAssistantChat({
    slug,
    conversationUuid,
    onConversationCreated: onConversationChange,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const voice = useVoice();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const quota = status?.quota;
  const showQuota = quota && !quota.unlimited && quota.limit > 0;

  const chatActions = useMemo(
    () => ({
      slug,
      busy: streaming,
      confirm: confirmAction,
      cancel: cancelAction,
    }),
    [slug, streaming, confirmAction, cancelAction],
  );

  return (
    <ChatActionsProvider value={chatActions}>
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {loadError ? (
            <p className="text-destructive text-sm">
              {t("ai.assistant.load_failed")}
            </p>
          ) : messages.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
              <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
                <Sparkles className="size-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">
                  {t("ai.assistant.empty_title")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t("ai.assistant.empty_description")}
                </p>
              </div>
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void send(t(key))}
                    disabled={streaming}
                    className="hover:bg-accent rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList messages={messages} />
          )}
        </div>
        <div className="space-y-1.5 border-t px-4 pt-3 pb-3">
          <Composer
            onSend={(text) => void send(text)}
            onStop={stop}
            streaming={streaming}
            autoFocus
            actions={
              voice
                ? (api) => (
                    <>
                      {composerActions}
                      <VoiceInput
                        onTranscript={(text) => {
                          if (voice.prefs.autoSend && !streaming)
                            void send(text);
                          else api.insertText(text);
                        }}
                      />
                    </>
                  )
                : composerActions
            }
          />
          {voice ? (
            <VoiceAutoRead messages={messages} streaming={streaming} />
          ) : null}
          <p className="text-muted-foreground flex flex-wrap justify-between gap-x-3 text-[11px]">
            <span>{t("ai.assistant.disclaimer")}</span>
            {showQuota ? (
              <span>
                {t("ai.assistant.quota_left", {
                  remaining: quota.remaining.toLocaleString(
                    locale === "tr" ? "tr-TR" : "en-US",
                  ),
                })}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </ChatActionsProvider>
  );
}
