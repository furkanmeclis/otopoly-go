"use client";

import { useQuery } from "@tanstack/react-query";

import { usersKeys } from "@/features/users/hooks/query-keys";
import type { ServerListParams } from "@/components/entity";
import {
  usersService,
  type ListUsersParams,
  type UserActivityParams,
} from "@/features/users/services/users.service";

export function useUsersList(params: ListUsersParams, enabled = true) {
  return useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => usersService.list(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUser(uuid: string | null, enabled = true) {
  return useQuery({
    queryKey: usersKeys.detail(uuid ?? ""),
    queryFn: () => usersService.get(uuid!),
    enabled: Boolean(uuid) && enabled,
  });
}

export function useUsersMeta(enabled = true) {
  return useQuery({
    queryKey: usersKeys.meta(),
    queryFn: () => usersService.meta(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUserOverview(uuid: string, enabled = true) {
  return useQuery({
    queryKey: usersKeys.overview(uuid),
    queryFn: () => usersService.overview(uuid),
    enabled: Boolean(uuid) && enabled,
  });
}

export function useUserOrganizations(
  uuid: string,
  params: ServerListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: usersKeys.organizations(uuid, params),
    queryFn: () => usersService.organizations(uuid, params),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUserSessions(
  uuid: string,
  params: ServerListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: usersKeys.sessions(uuid, params),
    queryFn: () => usersService.sessions(uuid, params),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUserDevices(
  uuid: string,
  params: ServerListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: usersKeys.devices(uuid, params),
    queryFn: () => usersService.devices(uuid, params),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUserActivity(
  uuid: string,
  params: UserActivityParams,
  enabled = true,
) {
  return useQuery({
    queryKey: usersKeys.activity(uuid, params),
    queryFn: () => usersService.activity(uuid, params),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previous) => previous,
  });
}
