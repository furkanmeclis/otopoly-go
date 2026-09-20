"use client";

import { permissions } from "@/config/permissions";
import { useAuth } from "@/providers/auth-provider";
import { usePermission } from "@/providers/permission-provider";

export function useTenantSalesAccess(slug: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find((org) => org.slug === slug);
  const isOwner = membership?.role === "owner";
  const canRead = hasPermission(permissions.sales.read);
  const canWrite = hasPermission(permissions.sales.write);
  const canVoid = isOwner && canWrite;
  return { membership, isOwner, canRead, canWrite, canVoid };
}
