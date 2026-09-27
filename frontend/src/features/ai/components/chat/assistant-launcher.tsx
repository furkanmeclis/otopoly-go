"use client";

import { Maximize2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { routes } from "@/config/routes";
import { AssistantChat } from "@/features/ai/components/chat/assistant-chat";
import { AssistantUnavailable } from "@/features/ai/components/chat/assistant-unavailable";
import { useAIStatus } from "@/features/ai/hooks/use-ai-status";
import { FeatureLocked } from "@/features/billing";
import { useLocale } from "@/providers/locale-provider";

/**
 * Floating assistant button (bottom-right, Ctrl/⌘+J) opening a side sheet chat.
 * Rendered on every tenant page; hidden unless the user may use the assistant
 * and the status endpoint reports it available.
 */
export function AssistantLauncher({ slug }: { slug: string }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const { status, allowed } = useAIStatus(slug);
  const [open, setOpen] = useState(false);
  const [conversationUuid, setConversationUuid] = useState<string | null>(null);

  const onAssistantPage = pathname?.startsWith(
    routes.tenant.assistant.root(slug),
  );
  const canUseAssistant =
    allowed && Boolean(status?.available) && status?.plan_enabled !== false;
  const locked = allowed && status?.plan_enabled === false;
  const visible = canUseAssistant && !onAssistantPage;
  const shouldRender = visible || (open && allowed && !onAssistantPage);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  if (!shouldRender) return null;

  return (
    <>
      {visible ? (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${t("ai.assistant.open")} (${t("ai.assistant.shortcut")})`}
          title={`${t("ai.assistant.open")} (${t("ai.assistant.shortcut")})`}
          className="fixed right-5 bottom-5 z-40 size-12 rounded-full shadow-lg md:right-6 md:bottom-6"
          data-testid="assistant-launcher"
        >
          <Sparkles className="size-5" />
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-2 border-b py-3 pr-12 pl-4">
            <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-sm font-semibold">
                {t("ai.assistant.title")}
              </SheetTitle>
              <SheetDescription className="text-muted-foreground text-xs">
                {t("ai.assistant.shortcut")}
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setConversationUuid(null)}
              title={t("ai.assistant.new_chat")}
              aria-label={t("ai.assistant.new_chat")}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              title={t("ai.assistant.open_full")}
              aria-label={t("ai.assistant.open_full")}
            >
              <Link
                href={
                  conversationUuid
                    ? routes.tenant.assistant.conversation(
                        slug,
                        conversationUuid,
                      )
                    : routes.tenant.assistant.root(slug)
                }
                onClick={() => setOpen(false)}
              >
                <Maximize2 className="size-4" />
              </Link>
            </Button>
          </div>
          {locked ? (
            <FeatureLocked slug={slug} className="m-4 min-h-[360px]" />
          ) : status?.available ? (
            <AssistantChat
              slug={slug}
              status={status}
              conversationUuid={conversationUuid}
              onConversationChange={setConversationUuid}
            />
          ) : (
            <AssistantUnavailable reason={status?.reason} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
