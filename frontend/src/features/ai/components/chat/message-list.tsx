"use client";

import { Sparkles } from "lucide-react";

import { MessageBlocks } from "@/features/ai/components/chat/message-blocks";
import type { ChatMessage } from "@/features/ai/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

function UserBubble({ message }: { message: ChatMessage }) {
  const text = message.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm break-words whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const { t } = useLocale();
  const empty = message.blocks.length === 0;
  return (
    <div className="flex gap-2.5">
      <div className="bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {empty && message.streaming ? (
          <p className="text-muted-foreground animate-pulse text-sm">
            {t("ai.assistant.thinking")}
          </p>
        ) : (
          <MessageBlocks blocks={message.blocks} />
        )}
        {message.status === "cancelled" && !message.streaming ? (
          <p className="text-muted-foreground text-xs italic">
            {t("ai.assistant.cancelled")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  className,
}: {
  messages: ChatMessage[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      {messages.map((message) =>
        message.role === "user" ? (
          <UserBubble key={message.uuid} message={message} />
        ) : (
          <AssistantMessage key={message.uuid} message={message} />
        ),
      )}
    </div>
  );
}
