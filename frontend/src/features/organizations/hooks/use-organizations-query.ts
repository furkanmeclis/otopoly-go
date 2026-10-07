"use client";

import { useQuery } from "@tanstack/react-query";

import { organizationsKeys } from "@/features/organizations/hooks/query-keys";
import {
  organizationsService,
  type ListOrganizationsParams,
  type OrganizationActivityParams,
} from "@/features/organizations/services/organizations.service";

export function useOrganizationsList(
  params: ListOrganizationsParams,
  enabled = true,
) {
  return useQuery({
    queryKey: organizationsKeys.list(params),
    queryFn: () => organizationsService.list(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useOrganization(uuid: string | null, enabled = true) {
  return useQuery({
    queryKey: organizationsKeys.detail(uuid ?? ""),
    queryFn: () => organizationsService.get(uuid!),
    enabled: Boolean(uuid) && enabled,
  });
}

export function useOrganizationsMeta(enabled = true) {
  return useQuery({
    queryKey: organizationsKeys.meta(),
    queryFn: () => organizationsService.meta(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useOrganizationOverview(uuid: string, enabled = true) {
  return useQuery({
    queryKey: organizationsKeys.overview(uuid),
    queryFn: () => organizationsService.overview(uuid),
    enabled: Boolean(uuid) && enabled,
  });
}

export function useOrganizationActivity(
  uuid: string,
  params: OrganizationActivityParams,
  enabled = true,
) {
  return useQuery({
    queryKey: organizationsKeys.activity(uuid, params),
    queryFn: () => organizationsService.activity(uuid, params),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previous) => previous,
  });
}
