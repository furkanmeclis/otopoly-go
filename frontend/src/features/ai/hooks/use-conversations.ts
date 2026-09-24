"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { aiKeys } from "@/features/ai/hooks/query-keys";
import { aiTenantService } from "@/features/ai/services/ai.service";

export function useConversationList(slug: string, q = "", enabled = true) {
  return useQuery({
    queryKey: aiKeys.conversationList(slug, q),
    queryFn: () => aiTenantService.listConversations({ q }),
    enabled,
  });
}

export function useConversationDetail(slug: string, uuid: string | null) {
  return useQuery({
    queryKey: aiKeys.conversation(slug, uuid ?? ""),
    queryFn: () => aiTenantService.getConversation(uuid ?? ""),
    enabled: Boolean(uuid),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRenameConversation(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uuid, title }: { uuid: string; title: string }) =>
      aiTenantService.renameConversation(uuid, title),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: aiKeys.conversations(slug) }),
  });
}

export function useDeleteConversation(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => aiTenantService.deleteConversation(uuid),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: aiKeys.conversations(slug) }),
  });
}
