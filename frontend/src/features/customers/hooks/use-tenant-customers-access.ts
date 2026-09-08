"use client";

import { permissions } from "@/config/permissions";
import { useAuth } from "@/providers/auth-provider";
import { usePermission } from "@/providers/permission-provider";

export function useTenantCustomersAccess(slug: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find((org) => org.slug === slug);
  const isOwner = membership?.role === "owner";
  const canRead = hasPermission(permissions.customers.read);
  const canWrite = isOwner && hasPermission(permissions.customers.write);
  return { membership, isOwner, canRead, canWrite };
}
