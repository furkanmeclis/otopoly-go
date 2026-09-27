"use client";

import { Plus, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { AssistantChat } from "@/features/ai/components/chat/assistant-chat";
import { AssistantUnavailable } from "@/features/ai/components/chat/assistant-unavailable";
import { ConversationList } from "@/features/ai/components/chat/conversation-list";
import { useAIStatus } from "@/features/ai/hooks/use-ai-status";
import { FeatureLocked } from "@/features/billing";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useLocale } from "@/providers/locale-provider";

export function AssistantPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationUuid = searchParams.get("c");
  const { status, allowed, isLoading, error } = useAIStatus(slug);

  const select = useCallback(
    (uuid: string | null) => {
      router.replace(
        uuid
          ? routes.tenant.assistant.conversation(slug, uuid)
          : routes.tenant.assistant.root(slug),
        { scroll: false },
      );
    },
    [router, slug],
  );

  if (!allowed) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("ai.unavailable.title")}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        icon={<Sparkles className="size-7" />}
        title={t("ai.assistant.title")}
        description={t("ai.assistant.description")}
      />
      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : status?.plan_enabled === false || isFeatureDisabledError(error) ? (
        <FeatureLocked slug={slug} className="min-h-[420px]" />
      ) : !status?.available ? (
        <div className="rounded-xl border">
          <AssistantUnavailable reason={status?.reason} />
        </div>
      ) : (
        <div className="grid h-[calc(100svh-13rem)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[260px_1fr]">
          <aside className="hidden min-h-0 flex-col gap-3 border-r p-3 md:flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => select(null)}
              className="justify-start"
            >
              <Plus className="size-4" />
              {t("ai.assistant.new_chat")}
            </Button>
            <p className="text-muted-foreground px-1 text-xs font-medium">
              {t("ai.assistant.history")}
            </p>
            <ConversationList
              slug={slug}
              activeUuid={conversationUuid}
              onSelect={select}
            />
          </aside>
          <section className="flex min-h-0 flex-col">
            <AssistantChat
              slug={slug}
              status={status}
              conversationUuid={conversationUuid}
              onConversationChange={(uuid) => select(uuid)}
            />
          </section>
        </div>
      )}
    </div>
  );
}
