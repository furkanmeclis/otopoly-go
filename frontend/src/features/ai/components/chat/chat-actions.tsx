"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AIUIBlock } from "@/features/ai/types";

export type ChatActions = {
  slug: string;
  /** True while any stream of this chat is running. */
  busy: boolean;
  confirm: (card: AIUIBlock, edits?: Record<string, string>) => Promise<void>;
  cancel: (card: AIUIBlock) => Promise<void>;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

export function ChatActionsProvider({
  value,
  children,
}: {
  value: ChatActions;
  children: ReactNode;
}) {
  return (
    <ChatActionsContext.Provider value={value}>
      {children}
    </ChatActionsContext.Provider>
  );
}

/** Confirm/cancel handlers for confirm cards (null outside a live chat). */
export function useChatActions() {
  return useContext(ChatActionsContext);
}
