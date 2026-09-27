"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useLocale } from "@/providers/locale-provider";

import { messagingService } from "@/features/messaging/services/messaging.service";
import type {
  PatchTemplateInput,
  SimulateInput,
  UpsertTemplateInput,
} from "@/features/messaging/types";

export const messagingKeys = {
  all: ["tenant", "messaging"] as const,
  session: () => [...messagingKeys.all, "session"] as const,
  rules: () => [...messagingKeys.all, "rules"] as const,
  templates: () => [...messagingKeys.all, "templates"] as const,
  template: (uuid: string) => [...messagingKeys.all, "template", uuid] as const,
};

export function useWhatsAppSession(options?: { pollWhilePairing?: boolean }) {
  const query = useQuery({
    queryKey: messagingKeys.session(),
    queryFn: () => messagingService.getSession(),
    retry: false,
    refetchInterval: (q) => {
      if (!options?.pollWhilePairing) return false;
      const status = q.state.data?.status;
      if (status === "qr_pending") return 1500;
      return false;
    },
  });
  return query;
}

export function useNotificationRules() {
  return useQuery({
    queryKey: messagingKeys.rules(),
    queryFn: () => messagingService.listRules(),
  });
}

export function useMessageTemplates() {
  return useQuery({
    queryKey: messagingKeys.templates(),
    queryFn: () => messagingService.listTemplates(),
  });
}

export function useConnectWhatsApp() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => messagingService.connectWhatsApp(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.session() });
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.connect_failed")),
  });
}

export function useDisconnectWhatsApp() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => messagingService.disconnectWhatsApp(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.session() });
      toast.success(t("messaging.toast.disconnected"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.disconnect_failed")),
  });
}

export function useToggleRule() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventType,
      channel,
      enabled,
    }: {
      eventType: string;
      channel: string;
      enabled: boolean;
    }) => messagingService.toggleRule(eventType, channel, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.rules() });
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.rule_failed")),
  });
}

export function useUpsertTemplate() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertTemplateInput) =>
      messagingService.upsertTemplate(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.templates() });
      toast.success(t("messaging.toast.template_saved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.template_save_failed")),
  });
}

export function usePatchTemplate() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: PatchTemplateInput }) =>
      messagingService.patchTemplate(uuid, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.templates() });
      toast.success(t("messaging.toast.template_updated"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.template_update_failed")),
  });
}

export function useSimulateMessaging() {
  const { t } = useLocale();
  return useMutation({
    mutationFn: (body: SimulateInput) => messagingService.simulate(body),
    onSuccess: (result) => {
      const failed = result.items.filter((i) => i.status !== "sent").length;
      const sent = result.items.length - failed;
      if (failed === 0) {
        toast.success(t("messaging.toast.simulate_sent", { sent }));
      } else {
        toast.error(t("messaging.toast.simulate_partial", { sent, failed }));
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.toast.simulate_failed")),
  });
}
