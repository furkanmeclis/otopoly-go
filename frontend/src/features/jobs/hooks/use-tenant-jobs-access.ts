"use client";

import { permissions } from "@/config/permissions";
import { useAuth } from "@/providers/auth-provider";
import { usePermission } from "@/providers/permission-provider";

export function useTenantJobsAccess(slug: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find((org) => org.slug === slug);
  const isOwner = membership?.role === "owner";
  const canRead = hasPermission(permissions.jobs.read);
  const canWrite = isOwner && hasPermission(permissions.jobs.write);
  const canExport = hasPermission(permissions.jobs.export);
  return { membership, isOwner, canRead, canWrite, canExport };
}
