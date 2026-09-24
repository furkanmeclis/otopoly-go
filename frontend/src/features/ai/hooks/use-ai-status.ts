"use client";

import { useQuery } from "@tanstack/react-query";

import { permissions } from "@/config/permissions";
import { aiKeys } from "@/features/ai/hooks/query-keys";
import { aiTenantService } from "@/features/ai/services/ai.service";
import { usePermission } from "@/providers/permission-provider";

/** Assistant availability for the current tenant user (null when not permitted). */
export function useAIStatus(slug: string) {
  const { can } = usePermission();
  const allowed = can(permissions.ai.use);
  const query = useQuery({
    queryKey: aiKeys.status(slug),
    queryFn: () => aiTenantService.getStatus(),
    enabled: allowed && Boolean(slug),
    staleTime: 60_000,
    retry: false,
  });
  return { ...query, allowed, status: allowed ? (query.data ?? null) : null };
}
