"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { messagingKeys } from "@/features/messaging/hooks/use-messaging";
import {
  templatesService,
  type SaveMessageTemplateInput,
  type TemplateKey,
} from "@/features/messaging/services/templates.service";
import { useLocale } from "@/providers/locale-provider";

export const templateCatalogKey = [...messagingKeys.all, "catalog"] as const;

export function useTemplateCatalog() {
  return useQuery({
    queryKey: templateCatalogKey,
    queryFn: () => templatesService.catalog(),
  });
}

export function useTemplateMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: templateCatalogKey });
    void qc.invalidateQueries({ queryKey: messagingKeys.templates() });
  };
  return {
    save: useMutation({
      mutationFn: ({
        key,
        body,
      }: {
        key: TemplateKey;
        body: SaveMessageTemplateInput;
      }) => templatesService.save(key, body),
      onSuccess: () => {
        toast.success(t("messaging.editor.saved"));
        invalidate();
      },
    }),
    reset: useMutation({
      mutationFn: (key: TemplateKey) => templatesService.reset(key),
      onSuccess: () => {
        toast.success(t("messaging.editor.reset_done"));
        invalidate();
      },
    }),
  };
}
