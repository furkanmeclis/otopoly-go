"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  mcpService,
  type McpClientListParams,
  type McpDecideRequest,
  type McpGrantListParams,
} from "@/features/mcp/services/mcp.service";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

export const mcpKeys = {
  all: ["mcp"] as const,
  info: () => [...mcpKeys.all, "info"] as const,
  consent: (uuid: string) => [...mcpKeys.all, "consent", uuid] as const,
  grants: (params?: McpGrantListParams) =>
    [...mcpKeys.all, "grants", params] as const,
  clients: (params?: McpClientListParams) =>
    [...mcpKeys.all, "clients", params] as const,
};

export function useMcpInfo() {
  return useQuery({
    queryKey: mcpKeys.info(),
    queryFn: () => mcpService.info(),
    staleTime: 5 * 60_000,
  });
}

export function useMcpConsent(uuid: string, enabled = true) {
  return useQuery({
    queryKey: mcpKeys.consent(uuid),
    queryFn: () => mcpService.consent(uuid),
    enabled: enabled && uuid !== "",
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useMcpDecide(uuid: string) {
  return useMutation({
    mutationFn: (body: McpDecideRequest) => mcpService.decide(uuid, body),
  });
}

export function useMcpGrants(params: McpGrantListParams) {
  return useQuery({
    queryKey: mcpKeys.grants(params),
    queryFn: () => mcpService.listGrants(params),
    placeholderData: keepPreviousData,
  });
}

export function useRevokeMcpGrant() {
  const qc = useQueryClient();
  const { t } = useLocale();
  return useMutation({
    mutationFn: (uuid: string) => mcpService.revokeGrant(uuid),
    onSuccess: async () => {
      appToast.success(t("mcp.grants.revoked"));
      await qc.invalidateQueries({ queryKey: [...mcpKeys.all, "grants"] });
    },
  });
}

export function useMcpClients(params: McpClientListParams, enabled = true) {
  return useQuery({
    queryKey: mcpKeys.clients(params),
    queryFn: () => mcpService.listClients(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRevokeMcpClient() {
  const qc = useQueryClient();
  const { t } = useLocale();
  return useMutation({
    mutationFn: (uuid: string) => mcpService.revokeClient(uuid),
    onSuccess: async () => {
      appToast.success(t("mcp.clients.revoked"));
      await qc.invalidateQueries({ queryKey: [...mcpKeys.all, "clients"] });
    },
  });
}
