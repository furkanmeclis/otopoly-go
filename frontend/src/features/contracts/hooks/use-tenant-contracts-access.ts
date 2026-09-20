"use client";

import { permissions } from "@/config/permissions";
import { useAuth } from "@/providers/auth-provider";
import { usePermission } from "@/providers/permission-provider";

export function useTenantContractsAccess(slug: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find((org) => org.slug === slug);
  const isOwner = membership?.role === "owner";
  const canRead = hasPermission(permissions.contracts.read);
  const canWrite = hasPermission(permissions.contracts.write);
  const canManage = isOwner && canWrite;
  return { membership, isOwner, canRead, canWrite, canManage };
}
