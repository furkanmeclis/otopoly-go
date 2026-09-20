"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => messagingService.connectWhatsApp(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.session() });
    },
    onError: (err: Error) =>
      toast.error(err.message || "WhatsApp bağlantısı başlatılamadı."),
  });
}

export function useDisconnectWhatsApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => messagingService.disconnectWhatsApp(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.session() });
      toast.success("WhatsApp bağlantısı kesildi.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Bağlantı kesilemedi."),
  });
}

export function useToggleRule() {
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
    onError: (err: Error) => toast.error(err.message || "Kural güncellenemedi."),
  });
}

export function useUpsertTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertTemplateInput) =>
      messagingService.upsertTemplate(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.templates() });
      toast.success("Şablon kaydedildi.");
    },
    onError: (err: Error) => toast.error(err.message || "Şablon kaydedilemedi."),
  });
}

export function usePatchTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: PatchTemplateInput }) =>
      messagingService.patchTemplate(uuid, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.templates() });
      toast.success("Şablon güncellendi.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Şablon güncellenemedi."),
  });
}

export function useSimulateMessaging() {
  return useMutation({
    mutationFn: (body: SimulateInput) => messagingService.simulate(body),
    onSuccess: (result) => {
      const failed = result.items.filter((i) => i.status !== "sent").length;
      const sent = result.items.length - failed;
      if (failed === 0) {
        toast.success(`${sent} test mesajı gönderildi.`);
      } else {
        toast.error(`${sent} başarılı, ${failed} başarısız.`);
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Simülasyon gönderilemedi."),
  });
}
