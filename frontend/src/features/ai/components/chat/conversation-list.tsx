"use client";

import { MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { DeleteDialog } from "@/components/dialogs/delete-dialog";
import { PromptDialog } from "@/components/dialogs/prompt-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConversationList,
  useDeleteConversation,
  useRenameConversation,
} from "@/features/ai/hooks/use-conversations";
import type { AIConversation } from "@/features/ai/types";
import { cn } from "@/lib/utils";
import { relativeDatetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

type ConversationListProps = {
  slug: string;
  activeUuid: string | null;
  onSelect: (uuid: string | null) => void;
};

export function ConversationList({
  slug,
  activeUuid,
  onSelect,
}: ConversationListProps) {
  const { t, locale } = useLocale();
  const [q, setQ] = useState("");
  const list = useConversationList(slug, q.trim());
  const rename = useRenameConversation(slug);
  const remove = useDeleteConversation(slug);
  const [renaming, setRenaming] = useState<AIConversation | null>(null);
  const [deleting, setDeleting] = useState<AIConversation | null>(null);

  const items = list.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("ai.assistant.search")}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {list.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            {t("ai.assistant.history_empty")}
          </p>
        ) : (
          items.map((conv) => {
            const when = conv.last_message_at ?? conv.created_at;
            return (
              <div
                key={conv.uuid}
                className={cn(
                  "group hover:bg-accent flex items-center gap-1 rounded-md pr-1",
                  conv.uuid === activeUuid && "bg-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(conv.uuid)}
                  className="min-w-0 flex-1 px-2.5 py-2 text-left"
                >
                  <p className="truncate text-sm font-medium">
                    {conv.title || t("ai.assistant.untitled")}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {relativeDatetime(when, locale)}
                  </p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label={t("ai.assistant.rename")}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(conv)}>
                      <Pencil className="size-3.5" />
                      {t("ai.assistant.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setDeleting(conv)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("ai.assistant.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })
        )}
      </div>

      <PromptDialog
        open={renaming !== null}
        title={t("ai.assistant.rename_title")}
        placeholder={renaming?.title || t("ai.assistant.rename_label")}
        confirmLabel={t("ai.assistant.save")}
        cancelLabel={t("ai.assistant.cancel")}
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          const target = renaming;
          setRenaming(null);
          if (!target || !value.trim()) return;
          rename.mutate({ uuid: target.uuid, title: value.trim() });
        }}
      />
      <DeleteDialog
        open={deleting !== null}
        title={t("ai.assistant.delete_title")}
        description={t("ai.assistant.delete_description")}
        cancelLabel={t("ai.assistant.cancel")}
        isPending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          remove.mutate(target.uuid, {
            onSuccess: () => {
              appToast.success(t("ai.assistant.deleted"));
              if (target.uuid === activeUuid) onSelect(null);
            },
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </div>
  );
}
